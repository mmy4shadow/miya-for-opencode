import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { type MouseEvent, type ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useRenderer } from "@opentui/solid"

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

export function ScrollSlider(props: { scroll: () => ScrollBoxRenderable | undefined; visible: () => boolean }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [dragging, setDragging] = createSignal(false)
  const [metrics, setMetrics] = createSignal({
    top: 0,
    height: 1,
    scrollHeight: 1,
  })

  const update = () => {
    const s = props.scroll()
    if (!s || s.isDestroyed) return
    const h = Math.max(1, Number.isFinite(s.viewport.height) ? s.viewport.height : s.height)
    const total = Math.max(h, Number.isFinite(s.scrollHeight) ? s.scrollHeight : h)
    setMetrics({
      top: Number.isFinite(s.scrollTop) ? s.scrollTop : 0,
      height: h,
      scrollHeight: total,
    })
  }

  createEffect(() => {
    if (!props.visible()) return
    update()
    const timer = setInterval(() => {
      update()
      renderer.requestRender()
    }, 80)
    onCleanup(() => clearInterval(timer))
  })

  const ratio = createMemo(() => {
    const m = metrics()
    const denom = Math.max(1, m.scrollHeight - m.height)
    return clamp(m.top / denom, 0, 1)
  })

  const thumb = createMemo(() => {
    const m = metrics()
    const track = m.height
    const size = clamp(Math.floor((m.height / m.scrollHeight) * track), 1, track)
    const top = Math.floor(ratio() * Math.max(0, track - size))
    const bottom = Math.max(0, track - top - size)
    return { top, size, bottom }
  })

  const jumpTo = (e: MouseEvent) => {
    const s = props.scroll()
    if (!s || s.isDestroyed) return
    const trackHeight = Math.max(1, Number.isFinite(s.viewport.height) ? s.viewport.height : metrics().height)
    const offset = Number.isFinite(s.viewport.y) ? s.viewport.y : s.y
    const t = thumb()
    const localY = clamp(e.y - offset, 0, trackHeight - 1)
    const center = clamp(localY - Math.floor(t.size / 2), 0, Math.max(0, trackHeight - t.size))
    const nextRatio = center / Math.max(1, trackHeight - t.size)
    const total = Number.isFinite(s.scrollHeight) ? s.scrollHeight : trackHeight
    s.scrollTo(Math.floor(nextRatio * Math.max(0, total - trackHeight)))
    renderer.requestRender()
  }

  return (
    <Show when={props.visible()}>
      <box
        width={2}
        height="100%"
        backgroundColor={theme.backgroundElement}
        border={["left"]}
        borderColor={theme.border}
        onMouseDown={(e: MouseEvent) => {
          setDragging(true)
          jumpTo(e)
        }}
        onMouseDrag={(e: MouseEvent) => {
          if (!dragging()) return
          jumpTo(e)
        }}
        onMouseDragEnd={() => setDragging(false)}
        onMouseUp={() => setDragging(false)}
      >
        <box width={1} height="100%" marginLeft={1} flexDirection="column">
          <box width={1} height={thumb().top} />
          <box width={1} height={thumb().size} backgroundColor={theme.text} />
          <box width={1} height={thumb().bottom} />
        </box>
      </box>
    </Show>
  )
}
