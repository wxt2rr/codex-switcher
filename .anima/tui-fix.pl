#!/usr/bin/perl
use strict;
use warnings;

local $/;
my $file = shift @ARGV || "plugins/codex-switcher/scripts/codex-switcher";
open(my $fh, "<", $file) or die "Cannot read $file: $!";
my $content = <$fh>;
close($fh);

# Fix 1: descs in tui_home_render_plain (followed by tui_clear_screen)
$content =~ s/
    "View usage and status dashboard"\n
    "Exit"\n
  \)\n
  \n
  tui_clear_screen
/    "View usage and status dashboard"\n    "View token refresh logs"\n    "Exit"\n  )\n\n  tui_clear_screen/x;

# Fix 2: descs in tui_home_render_menu_block (followed by TUI_COLOR_ENABLED)
$content =~ s/
    "View usage and status dashboard"\n
    "Exit"\n
  \)\n
  \n
  if \[\[ "\\\$TUI_COLOR_ENABLED" == "true" \]\]
/    "View usage and status dashboard"\n    "View token refresh logs"\n    "Exit"\n  )\n\n  if [[ "\$TUI_COLOR_ENABLED" == "true" ]]/x;

# Fix 3: navigation - change % 6 to % 7
$content =~ s/\(idx - 1 \+ 6\) % 6/(idx - 1 + 7) % 7/g;
$content =~ s/\(idx \+ 1\) % 6/(idx + 1) % 7/g;

# Fix 4: cmd_tui case - change -1|5 to -1|6, add 5) for Logs
$content =~ s/
      -1\|5\)\n
        break\n
        ;;\n
        \n
      0\)\n
        tui_action_switch \|\| true\n
        ;;\n
        \n
      1\)\n
        tui_action_accounts \|\| true\n
        ;;\n
        \n
      2\)\n
        tui_action_envs \|\| true\n
        ;;\n
        \n
      3\)\n
        tui_action_proxy \|\| true\n
        ;;\n
        \n
      4\)\n
        tui_action_status \|\| true\n
        ;;\n
/      -1|6)\n        break\n        ;;\n\n      0)\n        tui_action_switch || true\n        ;;\n\n      1)\n        tui_action_accounts || true\n        ;;\n\n      2)\n        tui_action_envs || true\n        ;;\n\n      3)\n        tui_action_proxy || true\n        ;;\n\n      4)\n        tui_action_status || true\n        ;;\n\n      5)\n        tui_action_logs || true\n        ;;\n/x;

# Fix 5: Insert tui_action_logs function before tui_home_logo
my $logs_func = <<'LOGSFUNC';
tui_action_logs() {
  local lang file lines key
  lang="$(read_ui_lang)"
  file="$TOKEN_REFRESH_LOG"

  while true; do
    tui_quit_requested && return 0

    if [[ -f "$file" ]]; then
      lines="$(cat "$file" 2>/dev/null || true)"
    else
      lines="(log file not found: $file)"
    fi

    while true; do
      tui_quit_requested && return 0

      tui_clear_screen
      tui_panel_open "Logs - $TOKEN_REFRESH_LOG"
      if [[ -n "$lines" ]]; then
        while IFS= read -r line; do
          tui_panel_line "$line"
        done <<< "$lines"
      else
        tui_panel_line "(empty)"
      fi
      tui_panel_close
      echo
      if [[ "$TUI_COLOR_ENABLED" == "true" ]]; then
        printf "%b%s%b\n" "$TUI_COLOR_DIM" "q / Esc back" "$TUI_COLOR_RESET"
      else
        echo "q / Esc back"
      fi

      key="$(tui_read_key || true)"
      [[ -n "$key" ]] || continue
      case "$key" in
        quit|esc)
          break
          ;;
      esac
    done
    break
  done
}

LOGSFUNC

$content =~ s/(tui_home_logo\(\))/${logs_func}$1/;

open($fh, ">", $file) or die "Cannot write $file: $!";
print $fh $content;
close($fh);
print "done\n";