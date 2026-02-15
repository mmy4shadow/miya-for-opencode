# Miya Audio Filler Assets

Put local filler clips in this directory.

- Supported formats: `.wav`, `.mp3`, `.ogg`
- Optional per-kind subfolders:
  - `training.image/`
  - `training.voice/`
  - `image.generate/`
  - `voice.tts/`
  - `vision.analyze/`
  - `shell.exec/`

If no local clip is found, Miya emits a fallback text cue and keeps execution non-blocking.

