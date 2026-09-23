/**
 * WeChat-style chat bubble colors.
 * Self messages use WeChat chat green; the other party uses a clean white /
 * dark-slate bubble. Kept in one place so text/image/file/voice bubbles stay
 * consistent and theme-aware (light + dark).
 */

/** Self bubble: WeChat chat green (light) / deeper green (dark). */
export const wechatSelfBubble =
  'bg-[#95EC69] text-[#1f1f1f] dark:bg-[#2f7d4f] dark:text-white shadow-sm';

/** Other bubble: clean white (light) / dark slate (dark) with a hairline border. */
export const wechatOtherBubble =
  'bg-card text-foreground shadow-sm border border-border/60';

/** Subtle inner surface on a self (green) bubble — icon chips, code, quote box. */
export const wechatSelfSubtle =
  'bg-black/10 text-[#1f1f1f] dark:text-white';

/** Link text color on a self (green) bubble. */
export const wechatSelfLink =
  'text-[#1f1f1f]/80 hover:text-[#1f1f1f] dark:text-white/80 dark:hover:text-white';
