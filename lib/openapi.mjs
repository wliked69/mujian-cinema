const genreArray = { type: 'array', minItems: 0, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 40 } };
const changeProperties = { genres: genreArray, reset: { type: 'boolean' }, expectedGenres: { ...genreArray, minItems: 0 } };
export const openapi = {
  openapi: '3.1.0', info: { title: '幕间 · 本地片库调试 API', version: '1.6.0', description: '调试令牌仅允许服务器本机调用，默认只读。classify 仅可读片库/任务状态/文档和修改分类；write 另可扫描与导入资料。不允许管理账号、读取评论或执行任意代码。' },
  servers: [{ url: 'http://127.0.0.1:3210' }], security: [{ debugToken: [] }],
  components: { securitySchemes: { debugToken: { type: 'http', scheme: 'bearer' } } },
  paths: Object.fromEntries([
    ['/api/admin/diagnostics', 'get', '读取运行诊断', null],
    ['/api/admin/audit', 'get', '读取脱敏操作审计（最近 100 条）', null],
    ['/api/library', 'get', '读取脱敏电影资料和来源概览（不含视频/图片链接、文件路径、账号偏好和收藏）', null],
    ['/api/job', 'get', '读取扫描/同步任务状态', null],
    ['/api/sync', 'post', '触发扫描（需要 write 令牌）', { type: 'object', properties: { sourceId: { type: 'string' } }, additionalProperties: false }],
    ['/api/movies/{id}/match', 'post', '根据片名搜索 TMDB 候选资料（向 TMDB 发送片名）', { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false }],
    ['/api/movies/{id}/enrich', 'post', '确认 TMDB 候选并导入电影资料（需要 write 令牌）', { type: 'object', properties: { tmdbId: { type: 'integer' } }, required: ['tmdbId'], additionalProperties: false }],
    ['/api/movies/{id}/genres', 'post', '修改/恢复单片分类（classify 或 write 令牌，expectedGenres 可防止覆盖并发修改）', { type: 'object', properties: changeProperties, anyOf: [{ required: ['genres'] }, { required: ['reset'], properties: { reset: { const: true } } }], additionalProperties: false }],
    ['/api/movies/genres/batch', 'post', '批量预览/提交分类；默认 dryRun=true，最多 100 部，整批校验后提交', { type: 'object', properties: { dryRun: { type: 'boolean', default: true }, updates: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { id: { type: 'string' }, ...changeProperties }, required: ['id'], additionalProperties: false } } }, required: ['updates'], additionalProperties: false }],
  ].map(([url, method, summary, schema]) => [url, { [method]: { summary,
    ...(url.includes('{id}') ? { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] } : {}),
    ...(schema ? { requestBody: { required: true, content: { 'application/json': { schema } } } } : {}),
    responses: { 200: { description: '成功' }, 202: { description: '任务已开始' }, 400: { description: '参数或来源错误' }, 401: { description: '未认证或令牌失效' }, 403: { description: '权限不足' }, 409: { description: 'expectedGenres 与当前分类不同，请重新读取' } },
  } }]))
};
