#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <aclapi.h>
#include <userenv.h>

#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#pragma comment(lib, "Advapi32.lib")
#pragma comment(lib, "Userenv.lib")

namespace {

struct CapabilityBuffer {
  std::vector<PSID> sids;
  std::vector<SID_AND_ATTRIBUTES> attributes;

  ~CapabilityBuffer() {
    for (PSID sid : sids) LocalFree(sid);
  }
};

struct AclGrant {
  std::wstring path;
  PSID sid = nullptr;
  bool changed = false;

  ~AclGrant() {
    if (changed && !path.empty() && sid) {
      PSECURITY_DESCRIPTOR descriptor = nullptr;
      PACL currentDacl = nullptr;
      if (GetNamedSecurityInfoW(
            const_cast<LPWSTR>(path.c_str()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            nullptr,
            nullptr,
            &currentDacl,
            nullptr,
            &descriptor
          ) == ERROR_SUCCESS) {
        EXPLICIT_ACCESSW revoke{};
        revoke.grfAccessMode = REVOKE_ACCESS;
        revoke.Trustee.TrusteeForm = TRUSTEE_IS_SID;
        revoke.Trustee.ptstrName = reinterpret_cast<LPWSTR>(sid);
        PACL newDacl = nullptr;
        if (SetEntriesInAclW(1, &revoke, currentDacl, &newDacl) == ERROR_SUCCESS) {
          SetNamedSecurityInfoW(
            const_cast<LPWSTR>(path.c_str()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            nullptr,
            nullptr,
            newDacl,
            nullptr
          );
          LocalFree(newDacl);
        }
      }
      if (descriptor) LocalFree(descriptor);
    }
    if (sid) LocalFree(sid);
  }
};

using DeriveCapabilitySidsFromNameFn = BOOL(WINAPI*)(
  LPCWSTR,
  PSID**,
  DWORD*,
  PSID**,
  DWORD*
);
using DeriveAppContainerSidFromAppContainerNameFn = HRESULT(WINAPI*)(PCWSTR, PSID*);

std::wstring valueFor(int argc, wchar_t** argv, const wchar_t* name) {
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::wstring(argv[i]) == name) return argv[i + 1];
  }
  return L"";
}

bool hasFlag(int argc, wchar_t** argv, const wchar_t* name) {
  for (int i = 1; i < argc; ++i) {
    if (std::wstring(argv[i]) == name) return true;
  }
  return false;
}

std::wstring quoteArgument(const std::wstring& value) {
  std::wstring quoted = L"\"";
  unsigned backslashes = 0;
  for (wchar_t character : value) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }
    if (character == L'\"') {
      quoted.append(backslashes * 2 + 1, L'\\');
      quoted.push_back(L'\"');
      backslashes = 0;
      continue;
    }
    quoted.append(backslashes, L'\\');
    quoted.push_back(character);
    backslashes = 0;
  }
  quoted.append(backslashes * 2, L'\\');
  quoted.push_back(L'\"');
  return quoted;
}

bool deriveInternetCapability(CapabilityBuffer& output) {
  HMODULE kernelbase = LoadLibraryW(L"kernelbase.dll");
  if (!kernelbase) return false;
  const auto deriveCapabilitySids = reinterpret_cast<DeriveCapabilitySidsFromNameFn>(
    GetProcAddress(kernelbase, "DeriveCapabilitySidsFromName")
  );
  if (!deriveCapabilitySids) {
    FreeLibrary(kernelbase);
    return false;
  }
  PSID* groupSids = nullptr;
  DWORD groupSidCount = 0;
  PSID* capabilitySids = nullptr;
  DWORD capabilitySidCount = 0;
  const BOOL derived = deriveCapabilitySids(
        L"internetClient",
        &groupSids,
        &groupSidCount,
        &capabilitySids,
        &capabilitySidCount
      );
  FreeLibrary(kernelbase);
  if (!derived || capabilitySidCount == 0) {
    if (groupSids) LocalFree(groupSids);
    if (capabilitySids) LocalFree(capabilitySids);
    return false;
  }
  if (groupSids) {
    for (DWORD i = 0; i < groupSidCount; ++i) LocalFree(groupSids[i]);
    LocalFree(groupSids);
  }
  output.sids.push_back(capabilitySids[0]);
  output.attributes.push_back({ capabilitySids[0], SE_GROUP_ENABLED });
  for (DWORD i = 1; i < capabilitySidCount; ++i) LocalFree(capabilitySids[i]);
  LocalFree(capabilitySids);
  return true;
}

HRESULT deriveExistingAppContainerSid(const std::wstring& profileName, PSID* sid) {
  HMODULE userenv = LoadLibraryW(L"userenv.dll");
  if (!userenv) return HRESULT_FROM_WIN32(GetLastError());
  const auto deriveSid = reinterpret_cast<DeriveAppContainerSidFromAppContainerNameFn>(
    GetProcAddress(userenv, "DeriveAppContainerSidFromAppContainerName")
  );
  if (!deriveSid) {
    const DWORD error = GetLastError();
    FreeLibrary(userenv);
    return HRESULT_FROM_WIN32(error == ERROR_SUCCESS ? ERROR_PROC_NOT_FOUND : error);
  }
  const HRESULT result = deriveSid(profileName.c_str(), sid);
  FreeLibrary(userenv);
  return result;
}

bool grantDirectoryAccess(const std::wstring& path, PSID appContainerSid, bool writable, AclGrant& grant) {
  const DWORD sidLength = GetLengthSid(appContainerSid);
  if (sidLength == 0) return false;
  auto* sidCopy = static_cast<PSID>(LocalAlloc(LMEM_FIXED, sidLength));
  if (!sidCopy || !CopySid(sidLength, sidCopy, appContainerSid)) {
    if (sidCopy) LocalFree(sidCopy);
    return false;
  }
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL oldDacl = nullptr;
  const DWORD result = GetNamedSecurityInfoW(
    const_cast<LPWSTR>(path.c_str()),
    SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION,
    nullptr,
    nullptr,
    &oldDacl,
    nullptr,
    &descriptor
  );
  if (result != ERROR_SUCCESS) {
    LocalFree(sidCopy);
    return false;
  }

  EXPLICIT_ACCESSW entry{};
  entry.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
  if (writable) entry.grfAccessPermissions |= FILE_GENERIC_WRITE | DELETE;
  entry.grfAccessMode = GRANT_ACCESS;
  entry.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  entry.Trustee.ptstrName = reinterpret_cast<LPWSTR>(appContainerSid);

  PACL newDacl = nullptr;
  if (SetEntriesInAclW(1, &entry, oldDacl, &newDacl) != ERROR_SUCCESS) {
    LocalFree(descriptor);
    LocalFree(sidCopy);
    return false;
  }
  const DWORD updateResult = SetNamedSecurityInfoW(
    const_cast<LPWSTR>(path.c_str()),
    SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION,
    nullptr,
    nullptr,
    newDacl,
    nullptr
  );
  LocalFree(newDacl);
  if (updateResult != ERROR_SUCCESS) {
    LocalFree(descriptor);
    LocalFree(sidCopy);
    return false;
  }
  grant.path = path;
  grant.sid = sidCopy;
  grant.changed = true;
  LocalFree(descriptor);
  return true;
}

int fail(const wchar_t* message, HRESULT error = S_OK) {
  std::wcerr << message;
  if (error != S_OK) std::wcerr << L" (0x" << std::hex << static_cast<unsigned long>(error) << L")";
  std::wcerr << L"\n";
  return 1;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
  const std::wstring profileName = valueFor(argc, argv, L"--profile");
  const std::wstring cwd = valueFor(argc, argv, L"--cwd");
  const std::wstring node = valueFor(argc, argv, L"--node");
  const std::wstring entry = valueFor(argc, argv, L"--entry");
  if (profileName.empty() || cwd.empty() || node.empty() || entry.empty()) return fail(L"missing AppContainer launcher arguments");

  CapabilityBuffer capabilities;
  if (hasFlag(argc, argv, L"--network") && !deriveInternetCapability(capabilities)) return fail(L"cannot derive internetClient capability", HRESULT_FROM_WIN32(GetLastError()));

  PSID appContainerSid = nullptr;
  const std::wstring displayName = L"Codex Switcher Plugin " + profileName;
  HRESULT profileResult = CreateAppContainerProfile(
    profileName.c_str(),
    displayName.c_str(),
    L"Isolated Codex Switcher provider plugin",
    capabilities.attributes.empty() ? nullptr : capabilities.attributes.data(),
    static_cast<DWORD>(capabilities.attributes.size()),
    &appContainerSid
  );
  if (profileResult == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
    profileResult = deriveExistingAppContainerSid(profileName, &appContainerSid);
  }
  if (FAILED(profileResult) || !appContainerSid) return fail(L"cannot create AppContainer profile", profileResult);

  AclGrant nodeGrant;
  const std::wstring nodeDirectory = std::filesystem::path(node).parent_path().wstring();
  if (nodeDirectory.empty() || !grantDirectoryAccess(nodeDirectory, appContainerSid, false, nodeGrant)) {
    FreeSid(appContainerSid);
    return fail(L"cannot grant AppContainer access to Node runtime directory", HRESULT_FROM_WIN32(GetLastError()));
  }

  AclGrant cwdGrant;
  if (!grantDirectoryAccess(cwd, appContainerSid, hasFlag(argc, argv, L"--filesystem"), cwdGrant)) {
    FreeSid(appContainerSid);
    return fail(L"cannot grant AppContainer access to plugin directory", HRESULT_FROM_WIN32(GetLastError()));
  }

  SIZE_T attributeSize = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeSize);
  auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(HeapAlloc(GetProcessHeap(), 0, attributeSize));
  if (!attributes) {
    FreeSid(appContainerSid);
    return fail(L"cannot allocate process attribute list", E_OUTOFMEMORY);
  }
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributeSize)) {
    HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appContainerSid);
    return fail(L"cannot initialize process attribute list", HRESULT_FROM_WIN32(GetLastError()));
  }

  SECURITY_CAPABILITIES securityCapabilities{};
  securityCapabilities.AppContainerSid = appContainerSid;
  securityCapabilities.Capabilities = capabilities.attributes.empty() ? nullptr : capabilities.attributes.data();
  securityCapabilities.CapabilityCount = static_cast<DWORD>(capabilities.attributes.size());
  if (!UpdateProcThreadAttribute(
        attributes,
        0,
        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
        &securityCapabilities,
        sizeof(securityCapabilities),
        nullptr,
        nullptr
      )) {
    DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appContainerSid);
    return fail(L"cannot attach AppContainer security capabilities", HRESULT_FROM_WIN32(GetLastError()));
  }

  std::wstring commandLine = quoteArgument(node) + L" " + quoteArgument(entry);
  std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
  mutableCommand.push_back(L'\0');
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION process{};
  const BOOL created = CreateProcessW(
    nullptr,
    mutableCommand.data(),
    nullptr,
    nullptr,
    TRUE,
    EXTENDED_STARTUPINFO_PRESENT,
    nullptr,
    cwd.c_str(),
    &startup.StartupInfo,
    &process
  );
  if (!created) {
    DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appContainerSid);
    return fail(L"cannot launch plugin inside AppContainer", HRESULT_FROM_WIN32(GetLastError()));
  }

  CloseHandle(process.hThread);
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 1;
  GetExitCodeProcess(process.hProcess, &exitCode);
  CloseHandle(process.hProcess);
  DeleteProcThreadAttributeList(attributes);
  HeapFree(GetProcessHeap(), 0, attributes);
  FreeSid(appContainerSid);
  return static_cast<int>(exitCode);
}
