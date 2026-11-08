import { randomUUID } from 'node:crypto';

export function commentText(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('评论需要 1–2000 个字符。');
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text) throw new Error('评论不能为空。');
  return text;
}
export function addComment(comments, movieId, userId, text, now = Date.now()) {
  const content = commentText(text);
  if (comments.length >= 10000 || comments.filter(c => c.movieId === movieId).length >= 500) throw new Error('评论存储已达到上限，请联系管理员清理。');
  if (comments.some(c => c.userId === userId && now - Date.parse(c.createdAt) < 3000)) { const error = new Error('评论发送太快，请 3 秒后再试。'); error.status = 429; throw error; }
  const comment = { id: randomUUID(), movieId, userId, text: content, createdAt: new Date(now).toISOString() };
  comments.push(comment); return comment;
}
export function publicComment(comment, users, actor) {
  const author = users.find(u => u.id === comment.userId);
  return { id: comment.id, movieId: comment.movieId, text: comment.text, createdAt: comment.createdAt,
    author: author?.displayName || '已移除用户', mine: actor.id === comment.userId, canDelete: actor.role === 'admin' || actor.id === comment.userId };
}
