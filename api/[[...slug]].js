// Vercel Serverless 函数入口
// 可选的全捕获路由：/api 下所有请求都交给 server.js 的 handler 处理
import { handler } from '../server.js';

// Hobby 计划函数最长 10 秒；关闭默认 body 解析（识曲接口要读原始 JSON 流）
export const config = {
  maxDuration: 10,
  api: {
    bodyParser: false
  }
};

export default handler;
