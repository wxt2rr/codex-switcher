import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./skills-page.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../react-app.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/desktop-shell.tsx", import.meta.url), "utf8");

test("skills page renders marketplace first and derives the remaining tabs from real scopes", () => {
  assert.match(source, /id: "marketplace"/);
  assert.match(source, /snapshot\?\.scopes/);
  assert.match(source, /scope\.name/);
  assert.match(source, /activeScopeId === "marketplace"/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected=\{activeScopeId === scope\.id\}/);
  assert.match(source, /data-skill-scope-id=\{scope\.id\}/);
  assert.match(source, /selectScope\(scope\.id\)/);
});

test("skills page exposes a marketplace source selector and passes source metadata to install", () => {
  assert.match(source, /marketplaceSourceId/);
  assert.match(source, /snapshot\?\.catalogSources/);
  assert.match(source, /selectMarketplaceSource/);
  assert.match(source, /marketplaceSourceId/);
  assert.match(source, /sourcePath: skill\.sourcePath/);
  assert.match(source, /ref: skill\.requestedRef/);
  const marketplaceToolbar = source.slice(source.indexOf('activeScope?.kind === "marketplace" ?'), source.indexOf(') : activeScope?.kind === "codex"'));
  assert.match(marketplaceToolbar, /onClick=\{\(\) => void loadSnapshot\(true\)\}/);
  assert.match(marketplaceToolbar, /刷新技能列表/);
});

test("skills scope controls stay interactive inside the macOS title-bar drag area", () => {
  assert.match(source, /relative z-20[^\n]*\[-webkit-app-region:no-drag\]/);
  assert.match(source, /active:scale-\[0\.97\][^\n]*\[-webkit-app-region:no-drag\]/);
});

test("skills page reuses the shared management-page visual system", () => {
  assert.match(source, /ListPageFrame/);
  assert.match(source, /ListCard/);
  assert.match(source, /ui-selected-control/);
  assert.match(source, /rounded-\[14px\][^\n]*bg-white/);
});

test("provider sync is global and each provider selects one Codex source environment", () => {
  assert.match(source, /ProviderBindingEditor/);
  assert.match(source, /CodexEnvironmentBinding/);
  assert.match(source, /codexScopes\.map/);
  assert.match(source, /data-codex-environment=\{scope\.envName\}/);
  assert.match(source, /scope\.path/);
  assert.match(source, /checked disabled readOnly/);
  assert.match(source, /bg-\[#34C759\]/);
  assert.doesNotMatch(source, /data-codex-environment=\{scope\.envName\}[\s\S]{0,500}<PackageOpen/);
  assert.match(source, /Primary store · \$\{scope\.skills\.length\} skills/);
  assert.match(source, /Source environment/);
  assert.match(source, /setSkillProviderBinding/);
  assert.match(source, /sourceEnv: draft\.enabled \? draft\.sourceEnv/);
  assert.doesNotMatch(source, /enabledProviders/);
});

test("provider directory sync copy explains symlink behavior and avoids ambiguous actions", () => {
  assert.match(source, /enabledSyncScopes = codexScopes\.length \+ providerBindings\.filter/);
  assert.match(source, /totalSyncScopes = codexScopes\.length \+ providerBindings\.length/);
  assert.match(source, /服务商目录同步 \$\{enabledSyncScopes\}\/\$\{totalSyncScopes\}/);
  assert.match(source, /开启后，将所选 Codex 环境中的 Skill 以软链接方式同步到对应服务商目录，无需重复安装。/);
  assert.match(source, /Provider directory sync/);
  assert.match(source, /symlinked into the provider's Skill directory/);
  assert.doesNotMatch(source, /\/5`/);
});

test("custom providers can be created and removed from the provider sync drawer", () => {
  assert.match(source, /bridge\.createSkillProvider/);
  assert.match(source, /bridge\.deleteSkillProvider/);
  assert.match(source, /添加服务商/);
  assert.match(source, /服务商名称/);
  assert.match(source, /Skill 目录/);
  assert.match(source, /binding\.custom \? \(\) => setRemoveProvider/);
});

test("skill scope tabs hide their scrollbar and expose directional edge fades", () => {
  assert.match(source, /scopeScrollerRef/);
  assert.match(source, /scrollWidth - scroller\.clientWidth/);
  assert.match(source, /scroller\.scrollLeft > 1/);
  assert.match(source, /horizontal-scroll-no-bar overflow-x-auto/);
  assert.match(source, /data-visible=\{scopeOverflow\.left\}/);
  assert.match(source, /data-visible=\{scopeOverflow\.right\}/);
});

test("skills page exposes lifecycle operations and security copy", () => {
  assert.match(source, /installSkill/);
  assert.match(source, /checkSkillUpdates/);
  assert.match(source, /updateSkill/);
  assert.match(source, /uninstallSkill/);
  assert.match(source, /Repository scripts and install hooks are never executed/);
});

test("marketplace and installed cards share descriptions and expose explicit details", () => {
  assert.match(source, /SkillDetailPanel/);
  assert.match(source, /onDetail/);
  assert.match(source, /查看 \$\{skill\.name\} 详情/);
  assert.match(source, /line-clamp-2 min-h-9/);
  assert.match(source, /市场 Skill 信息/);
  assert.match(source, /当前目录中的 Skill 信息/);
  assert.match(source, /View source/);
});

test("marketplace installation is immediate and Git installation does not ask for provider targets", () => {
  assert.match(source, /installMarketplaceSkill/);
  assert.match(source, /onInstall=\{\(\) => void installMarketplaceSkill\(skill\)\}/);
  assert.match(source, /beginGitInstall/);
  assert.doesNotMatch(source, /InstallTargetDraft/);
  assert.doesNotMatch(source, /使用范围（可多选）/);
  assert.doesNotMatch(source, /toggleInstallProvider/);
});

test("installation targets every Codex environment and follows provider bindings without changing sync configuration", () => {
  const installFlow = source.slice(source.indexOf("function installEnvironmentNames"), source.indexOf("async function checkUpdates"));
  assert.match(installFlow, /codexScopes\.map\(\(scope\) => scope\.envName\)/);
  assert.match(installFlow, /filter\(\(binding\) => binding\.enabled\)/);
  assert.match(installFlow, /map\(\(binding\) => binding\.sourceEnv\)/);
  assert.match(installFlow, /await bridge\.installSkill/);
  assert.doesNotMatch(installFlow, /setSkillProviderBinding/);
});

test("Git installation explains that every Codex environment receives the skill", () => {
  assert.match(source, /安装到全部 Codex 环境/);
  assert.match(source, /Installs to every Codex environment/);
});

test("skills route is wired into the desktop shell", () => {
  assert.match(app, /view === "skills"/);
  assert.match(app, /<SkillsPage/);
  assert.match(shell, /skills: <PackageOpen/);
});
