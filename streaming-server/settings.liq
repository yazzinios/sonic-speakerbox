# Liquidsoap global settings

# Enable telnet server for remote control (port 1234)
settings.server.telnet.set(true)
settings.server.telnet.bind_addr.set("0.0.0.0")
settings.server.telnet.port.set(1234)

# Log to stdout (supervisord captures it)
settings.log.stdout.set(true)
settings.log.level.set(3)

# Prevent Liquidsoap from exiting when a source fails
settings.init.allow_root.set(true)
