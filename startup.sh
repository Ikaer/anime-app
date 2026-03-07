#!/bin/sh

# Anime Tracker startup script
echo "Starting Anime Tracker initialization..."

# Create directories if they don't exist
mkdir -p /app/data /app/logs

# Set proper permissions
chown -R 1001:1001 /app/data /app/logs
chmod -R 755 /app/data /app/logs

echo "Directory initialization complete"

# Start the Next.js application
exec node server.js
