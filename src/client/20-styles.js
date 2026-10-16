/**
 * 组件样式。
 *
 * 规则：
 * - **不写死主题色**：每个视觉值都取 DSH 的 `--dsw-alias-*` 令牌，第二参是兜底；
 * - 数字全部 `font-variant-numeric: tabular-nums`，每 1.5 秒刷一次也不会左右跳；
 * - **动画是内容的一部分**：进度条平滑推进、运行中扫光、未知进度走马灯、
 *   环形进度旋转、弹层与行淡入；`prefers-reduced-motion` 下全部关闭；
 * - 不用 `backdrop-filter`，不引 CSS 框架。
 */

/** 插件样式标签的定位符（重复加载时避免叠加）。 */
const STYLE_SELECTOR = 'style[data-plugin-css="dsh-download-progress"]'

/** 组件 CSS。 */
const PANEL_CSS = `
@keyframes ddp-rotate{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}
@keyframes ddp-dash{0%{stroke-dasharray:1 150;stroke-dashoffset:0}
50%{stroke-dasharray:80 150;stroke-dashoffset:-30}100%{stroke-dasharray:80 150;stroke-dashoffset:-118}}
@keyframes ddp-shimmer{from{transform:translateX(-130%)}to{transform:translateX(330%)}}
@keyframes ddp-stripes{from{background-position:0 0}to{background-position:28px 0}}
@keyframes ddp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.72;transform:scale(.92)}}
@keyframes ddp-pop{from{opacity:0;transform:translateY(-6px) scale(.975)}to{opacity:1;transform:none}}
@keyframes ddp-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes ddp-flash{0%{background-color:var(--dsw-alias-state-success-primary,#2ea043)}100%{background-color:transparent}}
.ddp-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;
width:28px;height:28px;padding:0;border:0;border-radius:8px;cursor:pointer;background:transparent;
color:var(--dsw-alias-label-secondary,#a5a5b0);flex:none}
.ddp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
color:var(--dsw-alias-label-primary,#d6d6dd)}
.ddp-trigger[data-open="1"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));
color:var(--dsw-alias-label-primary,#d6d6dd)}
.ddp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.ddp-ring{position:absolute;top:0;left:0;width:28px;height:28px;transform:rotate(-90deg);
pointer-events:none;overflow:visible}
.ddp-ring circle{fill:none;stroke-width:2;stroke-linecap:round}
.ddp-ring-track{stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.ddp-ring-fill{stroke:var(--dsw-alias-brand-primary,#4d6bfe);
transition:stroke-dashoffset .55s cubic-bezier(.22,.61,.36,1)}
.ddp-ring--spin{animation:ddp-rotate 1.7s linear infinite}
.ddp-ring--spin .ddp-ring-fill{animation:ddp-dash 1.3s ease-in-out infinite;transition:none}
.ddp-glyph{display:block;position:relative;z-index:1}
.ddp-count{position:absolute;top:-3px;right:-4px;min-width:15px;height:15px;padding:0 4px;
border-radius:999px;font-size:9.5px;line-height:15px;text-align:center;font-weight:700;
font-variant-numeric:tabular-nums;color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);
box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#1b1b22)}
.ddp-count--live{animation:ddp-pulse 1.6s ease-in-out infinite}
.ddp-count--done{background:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-count--fail{background:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-pop{position:fixed;z-index:60;width:388px;max-width:calc(100vw - 20px);
max-height:min(64vh,540px);display:flex;flex-direction:column;overflow:hidden;border-radius:12px;
background:var(--dsw-alias-bg-layer-1,#1b1b22);color:var(--dsw-alias-label-primary,#d6d6dd);
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
box-shadow:0 14px 36px rgba(0,0,0,.3);transform-origin:top right;animation:ddp-pop .16s cubic-bezier(.2,.8,.3,1)}
.ddp-head{flex:none;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.ddp-head-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ddp-title{font-size:13px;font-weight:700}
.ddp-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a95);font-variant-numeric:tabular-nums}
.ddp-track{position:relative;height:6px;border-radius:999px;overflow:hidden;margin:8px 0 2px;
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
.ddp-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;overflow:hidden;
background-color:var(--dsw-alias-brand-primary,#4d6bfe);
transition:width .55s cubic-bezier(.22,.61,.36,1)}
.ddp-fill--live::after{content:'';position:absolute;top:0;bottom:0;left:0;width:42%;border-radius:999px;
background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);
animation:ddp-shimmer 1.7s ease-in-out infinite}
.ddp-fill--done{background-color:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-fill--failed{background-color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-fill--idle{background-color:var(--dsw-alias-label-tertiary,#8a8a95)}
.ddp-track--unknown .ddp-fill{width:100%;
background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.55) 0 8px,transparent 8px 20px);
background-size:28px 100%;animation:ddp-stripes .8s linear infinite}
.ddp-track--unknown .ddp-fill--live::after{display:none}
.ddp-list{flex:1;min-height:0;overflow:auto;padding:6px}
.ddp-icon-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
padding:0;border:0;border-radius:6px;cursor:pointer;background:transparent;
color:var(--dsw-alias-label-tertiary,#8a8a95)}
.ddp-icon-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#d6d6dd);
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.ddp-icon-btn:disabled{opacity:.4;cursor:default}
.ddp-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.ddp-note{flex:none;padding:6px 12px;font-size:11px;
border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
color:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-note--bad{color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-row{padding:8px 8px 9px;border-radius:8px;animation:ddp-rise .2s ease both}
.ddp-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.ddp-row--settled{opacity:.62}
.ddp-row--fresh{animation:ddp-rise .2s ease both,ddp-flash 1.1s ease-out .1s both}
.ddp-row-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.ddp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
font-size:12.5px;font-weight:600}
.ddp-name--link{display:block;text-align:left;padding:0;border:0;background:transparent;
font-family:inherit;font-size:12.5px;font-weight:600;color:var(--dsw-alias-brand-primary,#4d6bfe);
cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:2px;
transition:text-decoration-color .15s ease}
.ddp-name--link:hover{text-decoration-color:currentColor}
.ddp-name--link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;border-radius:4px}
.ddp-state{flex:none;font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;
border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,#a5a5b0)}
.ddp-state--running{color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.ddp-state--completed{color:var(--dsw-alias-state-success-primary,#2ea043);
border-color:var(--dsw-alias-state-success-primary,#2ea043)}
.ddp-state--failed,.ddp-state--killed{color:var(--dsw-alias-state-error-primary,#e5534b);
border-color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-state--stopping{color:var(--dsw-alias-state-warn-primary,#d29922);
border-color:var(--dsw-alias-state-warn-primary,#d29922)}
.ddp-meta{display:flex;flex-wrap:wrap;gap:2px 9px;margin-top:5px;font-size:11px;
color:var(--dsw-alias-label-secondary,#a5a5b0);font-variant-numeric:tabular-nums}
.ddp-pct{font-weight:700;color:var(--dsw-alias-label-primary,#d6d6dd)}
.ddp-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 18px 30px;text-align:center}
.ddp-empty-title{font-size:12.5px;color:var(--dsw-alias-label-secondary,#a5a5b0)}
.ddp-empty-hint{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#8a8a95);text-align:left;max-width:30em}
.ddp-error{margin:8px;padding:8px 10px;border-radius:8px;font-size:11px;word-break:break-word;
border:1px solid var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b)}
.ddp-foot{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:11px;
border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
color:var(--dsw-alias-label-tertiary,#8a8a95);font-variant-numeric:tabular-nums}
.ddp-foot-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddp-btn{flex:none;font:inherit;font-size:11px;cursor:pointer;padding:1px 9px;border-radius:6px;
color:var(--dsw-alias-label-secondary,#a5a5b0);background:transparent;
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.ddp-btn:hover{color:var(--dsw-alias-label-primary,#d6d6dd);
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
@media (prefers-reduced-motion:reduce){
.ddp-ring--spin,.ddp-ring--spin .ddp-ring-fill,.ddp-fill--live::after,
.ddp-track--unknown .ddp-fill,.ddp-count--live,.ddp-pop,.ddp-row{animation:none}
.ddp-fill{transition:none}
.ddp-ring-fill{transition:none}}
`

/**
 * 注入一次插件样式；fiber 卸载时移除。
 * @param {any} ctx - client 上下文。
 */
function installStyles(ctx) {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    if (document.querySelector(STYLE_SELECTOR) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-download-progress'
      tag.dataset.pluginCss = 'dsh-download-progress'
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }
    return () => {
      const existing = document.querySelector(STYLE_SELECTOR)
      if (existing !== null) existing.remove()
    }
  }, 'dsh-download-progress: styles')
}
