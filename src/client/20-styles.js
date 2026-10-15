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
const STYLE_SELECTOR = 'style[data-plugin-css="dsh-task-progress"]'

/** 组件 CSS。 */
const PANEL_CSS = `
@keyframes dtp-rotate{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}
@keyframes dtp-dash{0%{stroke-dasharray:1 150;stroke-dashoffset:0}
50%{stroke-dasharray:80 150;stroke-dashoffset:-30}100%{stroke-dasharray:80 150;stroke-dashoffset:-118}}
@keyframes dtp-shimmer{from{transform:translateX(-130%)}to{transform:translateX(330%)}}
@keyframes dtp-stripes{from{background-position:0 0}to{background-position:28px 0}}
@keyframes dtp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.72;transform:scale(.92)}}
@keyframes dtp-pop{from{opacity:0;transform:translateY(-6px) scale(.975)}to{opacity:1;transform:none}}
@keyframes dtp-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes dtp-flash{0%{background-color:var(--dsw-alias-state-success-primary,#2ea043)}100%{background-color:transparent}}
.dtp-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;
width:28px;height:28px;padding:0;border:0;border-radius:8px;cursor:pointer;background:transparent;
color:var(--dsw-alias-label-secondary,#a5a5b0);flex:none}
.dtp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));
color:var(--dsw-alias-label-primary,#d6d6dd)}
.dtp-trigger[data-open="1"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));
color:var(--dsw-alias-label-primary,#d6d6dd)}
.dtp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dtp-ring{position:absolute;top:0;left:0;width:28px;height:28px;transform:rotate(-90deg);
pointer-events:none;overflow:visible}
.dtp-ring circle{fill:none;stroke-width:2;stroke-linecap:round}
.dtp-ring-track{stroke:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.dtp-ring-fill{stroke:var(--dsw-alias-brand-primary,#4d6bfe);
transition:stroke-dashoffset .55s cubic-bezier(.22,.61,.36,1)}
.dtp-ring--spin{animation:dtp-rotate 1.7s linear infinite}
.dtp-ring--spin .dtp-ring-fill{animation:dtp-dash 1.3s ease-in-out infinite;transition:none}
.dtp-glyph{display:block;position:relative;z-index:1}
.dtp-count{position:absolute;top:-3px;right:-4px;min-width:15px;height:15px;padding:0 4px;
border-radius:999px;font-size:9.5px;line-height:15px;text-align:center;font-weight:700;
font-variant-numeric:tabular-nums;color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);
box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#1b1b22)}
.dtp-count--live{animation:dtp-pulse 1.6s ease-in-out infinite}
.dtp-count--done{background:var(--dsw-alias-state-success-primary,#2ea043)}
.dtp-count--fail{background:var(--dsw-alias-state-error-primary,#e5534b)}
.dtp-pop{position:fixed;z-index:60;width:388px;max-width:calc(100vw - 20px);
max-height:min(64vh,540px);display:flex;flex-direction:column;overflow:hidden;border-radius:12px;
background:var(--dsw-alias-bg-layer-1,#1b1b22);color:var(--dsw-alias-label-primary,#d6d6dd);
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));
box-shadow:0 14px 36px rgba(0,0,0,.3);transform-origin:top right;animation:dtp-pop .16s cubic-bezier(.2,.8,.3,1)}
.dtp-head{flex:none;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}
.dtp-head-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dtp-title{font-size:13px;font-weight:700}
.dtp-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a95);font-variant-numeric:tabular-nums}
.dtp-track{position:relative;height:6px;border-radius:999px;overflow:hidden;margin:8px 0 2px;
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
.dtp-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;overflow:hidden;
background-color:var(--dsw-alias-brand-primary,#4d6bfe);
transition:width .55s cubic-bezier(.22,.61,.36,1)}
.dtp-fill--live::after{content:'';position:absolute;top:0;bottom:0;left:0;width:42%;border-radius:999px;
background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);
animation:dtp-shimmer 1.7s ease-in-out infinite}
.dtp-fill--done{background-color:var(--dsw-alias-state-success-primary,#2ea043)}
.dtp-fill--failed{background-color:var(--dsw-alias-state-error-primary,#e5534b)}
.dtp-fill--idle{background-color:var(--dsw-alias-label-tertiary,#8a8a95)}
.dtp-track--unknown .dtp-fill{width:100%;
background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.55) 0 8px,transparent 8px 20px);
background-size:28px 100%;animation:dtp-stripes .8s linear infinite}
.dtp-track--unknown .dtp-fill--live::after{display:none}
.dtp-list{flex:1;min-height:0;overflow:auto;padding:6px}
.dtp-icon-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
padding:0;border:0;border-radius:6px;cursor:pointer;background:transparent;
color:var(--dsw-alias-label-tertiary,#8a8a95)}
.dtp-icon-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#d6d6dd);
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dtp-icon-btn:disabled{opacity:.4;cursor:default}
.dtp-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dtp-note{flex:none;padding:6px 12px;font-size:11px;
border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
color:var(--dsw-alias-state-success-primary,#2ea043)}
.dtp-note--bad{color:var(--dsw-alias-state-error-primary,#e5534b)}
.dtp-row{padding:8px 8px 9px;border-radius:8px;animation:dtp-rise .2s ease both}
.dtp-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dtp-row--settled{opacity:.62}
.dtp-row--fresh{animation:dtp-rise .2s ease both,dtp-flash 1.1s ease-out .1s both}
.dtp-row-head{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.dtp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
font-size:12.5px;font-weight:600}
.dtp-name--link{display:block;text-align:left;padding:0;border:0;background:transparent;
font-family:inherit;font-size:12.5px;font-weight:600;color:var(--dsw-alias-brand-primary,#4d6bfe);
cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:2px;
transition:text-decoration-color .15s ease}
.dtp-name--link:hover{text-decoration-color:currentColor}
.dtp-name--link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;border-radius:4px}
.dtp-state{flex:none;font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;
border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,#a5a5b0)}
.dtp-state--running{color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dtp-state--completed{color:var(--dsw-alias-state-success-primary,#2ea043);
border-color:var(--dsw-alias-state-success-primary,#2ea043)}
.dtp-state--failed,.dtp-state--killed{color:var(--dsw-alias-state-error-primary,#e5534b);
border-color:var(--dsw-alias-state-error-primary,#e5534b)}
.dtp-state--stopping{color:var(--dsw-alias-state-warn-primary,#d29922);
border-color:var(--dsw-alias-state-warn-primary,#d29922)}
.dtp-meta{display:flex;flex-wrap:wrap;gap:2px 9px;margin-top:5px;font-size:11px;
color:var(--dsw-alias-label-secondary,#a5a5b0);font-variant-numeric:tabular-nums}
.dtp-pct{font-weight:700;color:var(--dsw-alias-label-primary,#d6d6dd)}
.dtp-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 18px 30px;text-align:center}
.dtp-empty-title{font-size:12.5px;color:var(--dsw-alias-label-secondary,#a5a5b0)}
.dtp-empty-hint{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#8a8a95);text-align:left;max-width:30em}
.dtp-error{margin:8px;padding:8px 10px;border-radius:8px;font-size:11px;word-break:break-word;
border:1px solid var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b)}
.dtp-foot{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:11px;
border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
color:var(--dsw-alias-label-tertiary,#8a8a95);font-variant-numeric:tabular-nums}
.dtp-foot-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtp-btn{flex:none;font:inherit;font-size:11px;cursor:pointer;padding:1px 9px;border-radius:6px;
color:var(--dsw-alias-label-secondary,#a5a5b0);background:transparent;
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24))}
.dtp-btn:hover{color:var(--dsw-alias-label-primary,#d6d6dd);
background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
@media (prefers-reduced-motion:reduce){
.dtp-ring--spin,.dtp-ring--spin .dtp-ring-fill,.dtp-fill--live::after,
.dtp-track--unknown .dtp-fill,.dtp-count--live,.dtp-pop,.dtp-row{animation:none}
.dtp-fill{transition:none}
.dtp-ring-fill{transition:none}}
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
      tag.dataset.plugin = 'dsh-task-progress'
      tag.dataset.pluginCss = 'dsh-task-progress'
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }
    return () => {
      const existing = document.querySelector(STYLE_SELECTOR)
      if (existing !== null) existing.remove()
    }
  }, 'dsh-task-progress: styles')
}
