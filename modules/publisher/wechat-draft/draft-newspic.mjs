#!/usr/bin/env node
/**
 * 把一份「贴图版」Markdown 推成公众号【图片消息 / newspic】草稿。
 *
 * 与 draft.mjs 的区别：
 *   draft.mjs        → article_type=news（图文消息），需要封面 + HTML 正文
 *   draft-newspic.mjs → article_type=newspic（图片消息），图片走永久素材 media_id
 *
 * 链路：token → material/add_material(type=image) → draft/add(newspic) → draft/batchget 核对
 * 官方结构见 developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add.html
 *
 * 用法：
 *   node draft-newspic.mjs -f "贴图版.md" --dry-run   # 取 token + 传图 + 打印 payload，不建草稿
 *   node draft-newspic.mjs -f "贴图版.md"              # 建草稿并核对
 *   node draft-newspic.mjs -f "贴图版.md" --media-id <图> --update <草稿id>  # 改写已有草稿，不新建
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import matter from 'gray-matter';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://api.weixin.qq.com/cgi-bin';
const IMAGE_EXT_OK = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif']);
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // add_material 官方上限 10MB

const HINTS = [
  ['40164', 'IP 不在白名单：后台 → 设置与开发 → 基本配置 → IP 白名单，加当前公网 IP。'],
  ['48001', '接口未授权：该账号没有这个接口权限（个人未认证号常见）。'],
  ['40013', 'AppID 无效，检查 .env。'],
  ['40125', 'AppSecret 无效，重新生成并更新 .env。'],
  ['40001', '凭证无效：token 刚被别处刷新过，重跑一次即可。'],
  ['40007', 'media_id 无效，通常是图片没传成功。'],
  ['40005', '图片格式不支持，add_material 只收 bmp/png/jpeg/jpg/gif。'],
  ['45009', '接口调用超限，等一会儿再试。'],
  ['53404', '账号带货能力受限，本脚本不插商品，按官方建议删掉 product_info。'],
];

function usage() {
  console.log(`
用法: node draft-newspic.mjs -f <贴图版.md> [options]

必填:
  -f, --file       Markdown 文件（frontmatter 里要有 title、图片 字段）

可选:
      --title      覆盖标题（≤32 字）
      --image      覆盖图片路径（默认读 frontmatter 的「图片」）
      --media-id   复用已上传的永久图片素材 media_id（跳过上传，避免重复素材）
      --update     用 draft/update 改写这条草稿 media_id，不新建草稿
      --dry-run    只取 token + 上传图片素材 + 打印 payload，不建草稿/不更新
  -h, --help       显示帮助
`);
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      title: { type: 'string' },
      image: { type: 'string' },
      'media-id': { type: 'string' },
      update: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return values;
}

function readEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) throw new Error(`缺少 ${envPath}`);
  const kv = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) kv[m[1]] = m[2];
  }
  if (!kv.WECHAT_APP_ID || !kv.WECHAT_APP_SECRET) {
    throw new Error('.env 缺少 WECHAT_APP_ID / WECHAT_APP_SECRET');
  }
  return kv;
}

function extractCopy(markdown) {
  const m = markdown.match(/^##\s+文案[^\n]*\n([\s\S]*)/m);
  if (!m) throw new Error('没找到「## 文案」段落。');
  // 取到下一个二级标题为止；交付文件里以 > 开头的行是给作者看的备注，不进草稿
  const section = m[1].split(/^##\s+/m)[0];
  const text = section
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim();
  if (!text) throw new Error('文案段落是空的。');
  return text;
}

function checkWechatReply(json, stage) {
  if (json.errcode && json.errcode !== 0) {
    const hint = HINTS.filter(([code]) => String(json.errcode) === code).map(([, h]) => h);
    throw new Error(
      `${stage} 失败：errcode=${json.errcode} errmsg=${json.errmsg || ''}` +
        (hint.length ? `\n可能原因：\n- ${hint.join('\n- ')}` : ''),
    );
  }
  return json;
}

async function getToken(cfg) {
  const url = `${API}/token?grant_type=client_credential&appid=${encodeURIComponent(cfg.WECHAT_APP_ID)}&secret=${encodeURIComponent(cfg.WECHAT_APP_SECRET)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.access_token) return json.access_token;
  // checkWechatReply 会带上错误码提示，且不把 secret 打出来
  checkWechatReply(json, '获取 access_token');
  throw new Error('获取 access_token 失败：响应里既没有 token 也没有 errcode');
}

async function uploadImage(token, imagePath) {
  const buf = fs.readFileSync(imagePath);
  const form = new FormData();
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.bmp' ? 'image/bmp' : 'image/png';
  form.append('media', new Blob([buf], { type: mime }), `pic${ext}`);
  const res = await fetch(`${API}/material/add_material?access_token=${token}&type=image`, {
    method: 'POST',
    body: form,
  });
  const json = checkWechatReply(await res.json(), '上传永久图片素材 add_material');
  if (!json.media_id) throw new Error('add_material 没返回 media_id，响应：' + JSON.stringify(json));
  return json.media_id;
}

async function addDraft(token, payload) {
  const res = await fetch(`${API}/draft/add?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 中文必须直传，不能转成 \uXXXX（官方明确要求）
    body: JSON.stringify(payload),
  });
  const json = checkWechatReply(await res.json(), 'draft/add 新建图片消息草稿');
  if (!json.media_id) throw new Error('draft/add 没返回 media_id');
  return json.media_id;
}

async function updateDraft(token, mediaId, article) {
  const res = await fetch(`${API}/draft/update?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId, index: 0, articles: article }),
  });
  checkWechatReply(await res.json(), 'draft/update 改写图片消息草稿');
  return mediaId;
}

async function verifyDraft(token, mediaId, title) {
  const res = await fetch(`${API}/draft/batchget?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 0, count: 20, no_content: 1 }),
  });
  const json = checkWechatReply(await res.json(), 'draft/batchget 核对草稿箱');
  const items = json.item || [];
  const mine = items.filter((it) => it.media_id === mediaId);
  const sameTitle = items.filter((it) =>
    (it.content?.news_item || []).some((n) => n.title === title),
  );
  console.log(`\n核对草稿箱：total_count=${json.total_count}，本次返回 ${items.length} 条`);
  console.log(`  本次 media_id 命中：${mine.length} 条`);
  console.log(`  同标题草稿：${sameTitle.length} 条${sameTitle.length > 1 ? ' ⚠️ 可能有重复草稿' : ''}`);
  for (const it of sameTitle) {
    const t = (it.content?.news_item || [])[0]?.title || '(无标题)';
    console.log(`    - ${it.media_id}  ${t}  type=${it.content?.article_type || it.content?.news_item?.[0]?.article_type || '未返回'}`);
  }
  return { totalCount: json.total_count, hit: mine.length, sameTitle: sameTitle.length };
}

async function main() {
  const args = parseCli();
  if (args.help) return usage();
  if (!args.file) {
    usage();
    throw new Error('缺少 --file');
  }

  const mdFile = path.resolve(args.file);
  if (!fs.existsSync(mdFile)) throw new Error(`文件不存在：${mdFile}`);
  const parsed = matter(fs.readFileSync(mdFile, 'utf8'));

  const title = String(args.title || parsed.data.title || '').trim();
  if (!title) throw new Error('缺标题：frontmatter 加 title，或 --title 指定。');
  if (title.length > 32) throw new Error(`标题 ${title.length} 字，超过 32 字硬上限。`);

  const copy = extractCopy(parsed.content);
  const imageRel = String(args.image || parsed.data['图片'] || '').trim();
  if (!imageRel) throw new Error('缺图片：frontmatter 加「图片: 路径」，或 --image 指定。');
  const imagePath = path.isAbsolute(imageRel) ? imageRel : path.resolve(path.dirname(mdFile), imageRel);
  if (!fs.existsSync(imagePath)) throw new Error(`图片不存在：${imagePath}`);
  const ext = path.extname(imagePath).toLowerCase();
  if (!IMAGE_EXT_OK.has(ext)) throw new Error(`图片格式不支持：${ext}（只收 bmp/png/jpeg/jpg/gif）`);
  const bytes = fs.statSync(imagePath).size;
  if (bytes > IMAGE_MAX_BYTES) throw new Error(`图片 ${bytes} 字节，超过 10MB 上限。`);

  console.log(`源文件: ${mdFile}`);
  console.log(`标题  : ${title}`);
  console.log(`图片  : ${imagePath} (${bytes} 字节)`);
  console.log(`文案  : ${copy.length} 字符 / ${copy.split('\n\n').length} 段`);
  if (/<[a-z]/i.test(copy)) console.warn('注意：文案里出现 HTML 标签，图片消息 content 仅支持纯文本。');
  if (copy.includes('—')) console.warn('注意：文案里有破折号。');

  const cfg = readEnv();
  const token = await getToken(cfg);
  console.log('access_token: 已获取（不打印）');

  const imageMediaId = args['media-id']?.trim() || (await uploadImage(token, imagePath));
  console.log(
    `永久图片素材 media_id: ${imageMediaId}${args['media-id'] ? '（复用，未重复上传）' : ''}`,
  );

  const payload = {
    articles: [
      {
        article_type: 'newspic',
        title,
        author: String(parsed.data.author || '阿茶').trim() || '阿茶',
        content: copy,
        need_open_comment: 0,
        only_fans_can_comment: 0,
        image_info: { image_list: [{ image_media_id: imageMediaId }] },
      },
    ],
  };

  const article = payload.articles[0];
  const updating = Boolean(args.update);
  console.log(`\n即将提交的 ${updating ? 'draft/update' : 'draft/add'} payload：`);
  console.log(
    JSON.stringify(
      updating ? { media_id: args.update, index: 0, articles: article } : payload,
      null,
      2,
    ),
  );

  if (args['dry-run']) {
    console.log('\n[dry-run] 已打印 payload，未建草稿、未改写草稿。');
    return;
  }

  const draftMediaId = updating
    ? await updateDraft(token, args.update, article)
    : await addDraft(token, payload);
  console.log(
    `\n${updating ? '草稿已改写' : '草稿已创建'}，未发布。media_id: ${draftMediaId}`,
  );
  await verifyDraft(token, draftMediaId, title);
  console.log('\n下一步：mp.weixin.qq.com → 草稿箱 → 手机预览 → 手动发表。');
  console.log('（个人未认证号 freepublish 接口不可用，发表只能走后台。）');
}

try {
  await main();
} catch (error) {
  console.error(`\n失败：${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
}
