/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: undefined,
  // Next's file-tracer (@vercel/nft) statically follows the
  // `LOCALAPPDATA || APPDATA || ...` env-var fallback baked into
  // TypeScript's bundled lib files (required during the build's type
  // check) and tries to glob the whole %APPDATA%\Roaming tree to see
  // what it might read, which EPERMs on the Start Menu junction on
  // Windows. These paths are never part of the app itself, so they're
  // safe to skip during tracing.
  outputFileTracingExcludes: {
    '*': ['**/AppData/**', '**/Start Menu/**'],
  },
}

module.exports = nextConfig
