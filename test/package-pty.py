"""Run the installed npx entrypoint using the existing PTY assertions."""
from terminal_smoke import scenario, exit_status

# npx is an additional parent process; allow its own cleanup after CLI exit.
scenario(['npx', '--no-install', 'aranea'], exit_status, exit_timeout=15)
