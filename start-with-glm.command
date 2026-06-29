#!/bin/zsh

set -e

cd "$(dirname "$0")"

echo "群核期权助手 · 智谱 GLM 启动"
echo
read -s "ZHIPU_API_KEY?请输入新生成的智谱 API Key（输入内容不会显示）："
echo

if [[ -z "$ZHIPU_API_KEY" ]]; then
  echo "未输入 API Key，已取消启动。"
  exit 1
fi

export AI_PROVIDER="zhipu"
export ZHIPU_API_KEY
export ZHIPU_TEXT_MODEL="${ZHIPU_TEXT_MODEL:-glm-4.7-flash}"
export ZHIPU_VISION_MODEL="${ZHIPU_VISION_MODEL:-glm-4.6v-flash}"

echo "正在启动：http://127.0.0.1:4173"
exec npm start
