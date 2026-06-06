# Audio alert clips

Drop your alert sounds in this folder. Short clips (0.5–2s) work best.

## Quickest setup — one file for everything
Add a single file named **`alert.mp3`** here. It will be used for all three
alert types (proximity, collision/advisory, overload).

## Optional — a distinct sound per alert type
Add any of these (each one overrides `alert.mp3` for that type):

| File              | Plays when…                                            |
|-------------------|--------------------------------------------------------|
| `proximity.mp3`   | An aircraft enters CRITICAL range (your proximity radius) |
| `collision.mp3`   | An aircraft enters WARNING / advisory range            |
| `overload.mp3`    | The data feed errors out or hits a rate limit          |

If a per-type file is missing, the system falls back to `alert.mp3`.
If no files exist at all, alerts are silently skipped (no errors).

## Where the toggles live
Enable/disable each sound on the **Alerts** page. The sounds themselves fire on
the **Radar** page, where live proximity events are detected.

`.mp3`, `.wav`, and `.ogg` all work — just match the filename (e.g. `alert.wav`
won't be found if the code looks for `alert.mp3`; rename to `.mp3` or tell me to
change the extension).
