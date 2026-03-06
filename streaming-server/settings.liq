# Liquidsoap global settings for 2.1.x (Debian Bookworm)

# Enable telnet control server on port 1234
set("server.telnet", true)
set("server.telnet.bind_addr", "0.0.0.0")
set("server.telnet.port", 1234)

# Logging
set("log.stdout", true)
set("log.level", 3)
