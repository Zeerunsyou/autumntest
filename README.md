# IdleLock Settings Studio

A browser dashboard for editing movement preference profiles and syncing them between PCs you control. When configured, it can also sync the active profile movement settings with the companion Roblox script for the matching account.

## Run the host

Python 3.9 or newer is required. No third-party packages are needed.

In PowerShell on the PC that will host the dashboard:

```powershell
$env:IDLELOCK_API_KEY = (python -c "import secrets; print(secrets.token_hex(32))")
Write-Host "Server access key: $env:IDLELOCK_API_KEY"
python .\dashboard\server.py
```

Keep the PowerShell window open while the host is running. Copy the generated key into the dashboard on each PC that will sync. The server stores profiles in `dashboard\data\profiles.json` and script stats in `dashboard\data\telemetry.json`. The access key is required on every API request; it is not saved in the profile data.

On the host PC, open `http://localhost:8765`. On another PC on the same trusted network, open `http://HOST-PC-IP:8765`, where `HOST-PC-IP` is the host computer's local IP address. Allow incoming connections through the host's firewall only on a trusted private network. You can set `IDLELOCK_PORT` to choose another port, or `IDLELOCK_HOST=127.0.0.1` to keep access on the host PC only.

To find the host PC's local IP on Windows, run `ipconfig` in another PowerShell window and use the IPv4 Address under the active Wi-Fi or Ethernet adapter.

## Sync profiles

In the dashboard's **Hosted sync** card, enter the address of the host and the access key printed nowhere by the server: copy it from the PowerShell session where you set `IDLELOCK_API_KEY`. Select **Connect** to check the key. **Upload local** saves your current local profiles to the host, replacing the host's current profile set. **Download** replaces this browser's profiles with the host's set after confirmation.

## Sync settings with the Roblox script

In the script Dashboard Settings, set API URL to this host, enter the same IDLELOCK_API_KEY in the script, then enable Dashboard. In Roblox Config Sync, enter the numeric Roblox account ID. Dashboard to Roblox sends the active profile to the host; Roblox to Dashboard loads the host copy into the active profile. The script checks for changes about every four minutes and sends script-side movement setting changes back to the host. The API URL left blank uses the existing GumTune destination, which does not provide this project config sync API.

The script API currently uses the same HTTP/HTTPS endpoint and `X-API-Key` header as this host. Do not expose the server publicly over plain HTTP: the access key and dashboard data would be transmitted without transport encryption.

The access key is saved in the browser's local storage for convenience. Anyone with access to that browser profile can use it. Use HTTPS through a trusted reverse proxy before exposing the server outside your private network; the built-in Python server is intended for trusted networks and does not provide TLS or user accounts.

To stop the server, press `Ctrl+C` in its PowerShell window. The profile file remains on the host for the next run.


