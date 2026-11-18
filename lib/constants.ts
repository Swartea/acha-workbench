export const PLATFORM_LIMITS = [
  { item: '标题', spec: '≤ 32 字', note: '超过推送工具直接报错退出' },
  { item: '作者', spec: '≤ 16 字', note: 'frontmatter 生效，--author 为可选覆盖' },
  { item: '摘要', spec: '≤ 120 字', note: '留空自动抓正文前 54 字' },
  { item: '正文', spec: '≤ 2 万字符 / ≤ 1MB', note: '官方三个数字自相矛盾，按最严口径' },
  { item: '正文图', spec: '仅 jpg/png · 单张 < 1MB', note: 'SVG 不支持，工具硬拦' },
  { item: '封面', spec: '永久素材 · 10MB', note: '建议 JPEG；裁切仅 2.35:1 与 1:1' },
  { item: '正文外链', spec: '仅已群发文章链接', note: '完整外链走「阅读原文」，≤ 1KB，每篇 1 个' },
  { item: '代码块 / 表格', spec: '手机端会截断 / 溢出', note: '<pre> 与 <table> 尽量不用' },
  { item: '字体', spec: '不建议设置 font-family', note: '用系统默认栈' },
] as const;

export const COMPLIANCE = [
  '只调用 draft/add 进草稿箱，不调用 freepublish/*；发表由账号持有人手动完成（运营规范 3.27.2）。',
  'AppSecret 只放本机 .env（chmod 600），绝不进 git；公网 IP 同样不入库。',
  '选题 / 研究 / 写稿 / 检查 / 返工由 AI 自主闭环（2026-11-14 规则）；不虚构实测与个人经历。',
] as const;

export const AUTOMATION_RULES = [
  {
    id: 'R1',
    name: '写手轮',
    trigger: '每日 08 / 12 / 16 / 20',
    condition: '有 P0 选题缺写作包',
    action: '产出写作包 → 写状态 API',
    notify: '看板徽标',
  },
  {
    id: 'R2',
    name: '口径快检',
    trigger: '每日 08:00',
    condition: '已排期 / 已发稿件引用的版本、价格、链接',
    action: '换入口抓取比对，结果写库',
    notify: '零变动静默；有变动标红',
  },
  {
    id: 'R3',
    name: '发布日链',
    trigger: '手动点「推草稿」',
    condition: '三前置全绿 + 预检全过',
    action: '干跑 → 预检 → 预览 → draft/add',
    notify: '结果 + 后台深链',
  },
  {
    id: 'R4',
    name: '截止时钟',
    trigger: '每小时',
    condition: '选题带外部截止',
    action: 'T-24h / T-2h 升级提醒',
    notify: '看板首位',
  },
  {
    id: 'R5',
    name: '复盘拉数',
    trigger: '发布后 24h / 72h',
    condition: '数据 API 可达',
    action: '拉阅读/完读/在看/涨粉入面板',
    notify: '看板「复盘就绪」',
  },
  {
    id: 'R6',
    name: '逾期升级',
    trigger: '每日 20:00',
    condition: '待拍板事项 > 3 天未动',
    action: '升级到「唯一动作」位',
    notify: '看板 + 邮件',
  },
  {
    id: 'R7',
    name: '凭据巡检',
    trigger: '每周一 09:00',
    condition: '.env 存在且权限 600、字段非空',
    action: '输出绿 / 红态',
    notify: '仅异常时通知',
  },
] as const;

