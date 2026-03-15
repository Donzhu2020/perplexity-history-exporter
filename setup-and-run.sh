#!/bin/bash
# Perplexity History Export - 一键安装启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  🔮 Perplexity History Export 安装 & 启动"
echo "================================================"
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装：https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低（当前: $(node -v)），请升级到 v18+"
    exit 1
fi

echo "✅ Node.js $(node -v) 已就绪"
echo ""

# Install dependencies
echo "📦 安装依赖（首次运行需要几分钟）..."
npm install --ignore-scripts

echo ""
echo "🌐 安装 Chromium 浏览器（首次运行约100MB下载）..."
npx playwright install chromium

echo ""
echo "================================================"
echo "  ✅ 安装完成！正在启动工具..."
echo "================================================"
echo ""
echo "  使用说明："
echo "  1. 选择 'Start scraper (Library)'"
echo "  2. 如提示登录，在弹出的浏览器里登录你的 Perplexity 账号"
echo "  3. 工具会自动等待并检测登录状态，无需回终端按 Enter"
echo "  4. 登录后会先发现会话，再尽量切到后台模式继续导出"
echo "  5. 历史记录将保存在 exports/ 文件夹"
echo ""

npm run dev
