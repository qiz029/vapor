# Vapor Remotion

Optional local `video.render` adapter for Vapor Framework. The release builder includes its renderer sources and exact npm dependencies; the installed package does not require Agent Media Lab.

Requires Node 24+, FFmpeg/ffprobe on PATH, and a Chromium browser. The original adapter retains its 1–10 second title card. The 0.3 tool catalog additionally exposes full manifest validation/rendering, still frames, five MV looks and animatics. Video renders receive full decode checks; visual review remains pending. See [operations and input contracts](TOOLS.md).

Install after `@toddzheng024/vapor`, using the same 0.3.0 release. Development source still supports `VAPOR_WORKSPACE_ROOT`; release packages use their own renderer resources. No private media, model weights or credentials are included. Set `REMOTION_BROWSER_EXECUTABLE` when using your own compatible browser.

Remotion dependencies retain their own licensing terms. Check those terms for your intended use; this release candidate has not selected a license for Vapor's own code.
