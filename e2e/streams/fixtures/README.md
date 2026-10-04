# Resume media

`resume.mp4` and `resume.mkv` are synthetic, silent H.264 videos (160×90,
10 fps, 130 seconds). Red frames cover 0–40s, green 40–80s, blue 80–130s.
The resume tests use both playback time and decoded pixels to distinguish
successful seeks from starting at zero. Their duration exceeds the app's
short/error-clip progress cutoff. No network media or credentials are used.

Generated with ffmpeg; the committed fixtures mean test runners do not need it:

```bash
ffmpeg -y \
  -f lavfi -i 'color=c=red:s=160x90:r=10:d=40' \
  -f lavfi -i 'color=c=lime:s=160x90:r=10:d=40' \
  -f lavfi -i 'color=c=blue:s=160x90:r=10:d=50' \
  -filter_complex '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]' \
  -map '[v]' -c:v libx264 -pix_fmt yuv420p -preset ultrafast -g 10 \
  -movflags +faststart resume.mp4
ffmpeg -y -i resume.mp4 -c copy resume.mkv
```
