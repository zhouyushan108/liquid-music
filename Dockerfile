# Hugging Face Spaces Docker 配置
# 应用零依赖，直接使用官方 Node 运行时即可
FROM node:20-slim

WORKDIR /app

# 拷贝全部代码（server.js + public/）
COPY . .

# HF Spaces 要求应用监听 7860 端口
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
