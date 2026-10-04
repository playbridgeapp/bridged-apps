# Browser audio queue fixture

`queue.m4a` is a synthetic 30-second 440 Hz sine tone (mono AAC, 22,050 Hz, 24 kbps). It contains no personal media and tests real browser audio buffering, Next, EOF, repeat, and progress reporting. It is served with byte-range support by the mocked Jellyfin fixture.

Generated with:

```bash
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=22050:duration=30' \
  -c:a aac -b:a 24k -movflags +faststart queue.m4a
```
