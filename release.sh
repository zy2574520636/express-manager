#!/bin/bash
set -e

# ===== 快递管理系统 一键发布脚本 =====
# 用法: ./release.sh [版本号] [更新说明]
# 示例: ./release.sh 1.7.0 "新增xxx功能"

# ===== 配置 =====
ANDROID_HOME=/data/user/work/android-sdk
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/34.0.0:$JAVA_HOME/bin:$PATH

WEB_DIR=/workspace/express-manager
APP_DIR=/workspace/express-app/app
SRC_DIR=$APP_DIR/src/main
APK_OUT=$APP_DIR/我的快递.apk

# GitHub 配置（从 git remote 中提取 token 和仓库信息）
GITHUB_TOKEN=$(git -C "$WEB_DIR" remote get-url origin | sed -n 's|https://\([^@]*\)@.*|\1|p')
GITHUB_REPO=$(git -C "$WEB_DIR" remote get-url origin | sed -n 's|.*github.com/\(.*\)\.git|\1|p')

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ 无法获取 GitHub Token，请检查 git remote 配置"
  exit 1
fi
if [ -z "$GITHUB_REPO" ]; then
  echo "❌ 无法获取仓库信息"
  exit 1
fi

# ===== 参数处理 =====
if [ $# -lt 1 ]; then
  echo "用法: ./release.sh <版本号> [更新说明]"
  echo "示例: ./release.sh 1.7.0 '新增xxx功能'"
  echo ""
  echo "当前版本:"
  grep '"versionName"' "$WEB_DIR/version.json" | head -1
  exit 1
fi

VERSION_NAME="$1"
# 从 versionName 生成 versionCode（取数字部分，如 1.7.0 -> 170）
VERSION_CODE=$(echo "$VERSION_NAME" | tr -d '.' | sed 's/^0*//')
if [ -z "$VERSION_CODE" ]; then VERSION_CODE=1; fi

CHANGELOG="${2:-版本更新}"

echo "=========================================="
echo "  🚀 快递管理系统 - 一键发布"
echo "=========================================="
echo "  版本号: v$VERSION_NAME (versionCode: $VERSION_CODE)"
echo "  更新说明: $CHANGELOG"
echo "  仓库: $GITHUB_REPO"
echo "=========================================="
read -p "  确认发布？(y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "已取消"
  exit 0
fi

# ===== 1. 更新 version.json =====
echo ""
echo "📝 更新 version.json..."
cat > "$WEB_DIR/version.json" <<EOF
{
  "versionCode": $VERSION_CODE,
  "versionName": "$VERSION_NAME",
  "apkUrl": "https://ghproxy.net/https://github.com/${GITHUB_REPO}/releases/download/v${VERSION_NAME}/express-manager.apk",
  "apkUrls": [
    "https://ghproxy.net/https://github.com/${GITHUB_REPO}/releases/download/v${VERSION_NAME}/express-manager.apk",
    "https://gh.api.99988866.xyz/https://github.com/${GITHUB_REPO}/releases/download/v${VERSION_NAME}/express-manager.apk",
    "https://github.moeyy.xyz/https://github.com/${GITHUB_REPO}/releases/download/v${VERSION_NAME}/express-manager.apk",
    "https://github.com/${GITHUB_REPO}/releases/download/v${VERSION_NAME}/express-manager.apk"
  ],
  "changelog": "$CHANGELOG"
}
EOF
echo "  ✅ version.json 已更新"

# ===== 2. 更新 AndroidManifest.xml =====
echo "📝 更新 AndroidManifest.xml..."
MANIFEST="$SRC_DIR/AndroidManifest.xml"
sed -i "s/android:versionCode=\"[^\"]*\"/android:versionCode=\"$VERSION_CODE\"/" "$MANIFEST"
sed -i "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION_NAME\"/" "$MANIFEST"
echo "  ✅ AndroidManifest.xml 已更新"

# ===== 3. 构建 APK =====
echo ""
echo "🏗️  构建 APK..."
cd "$(dirname "$0")"
bash "$APP_DIR/../build.sh" 2>&1 | tail -5
echo "  ✅ APK 构建完成"

# ===== 4. 复制 APK 到 web 目录 =====
cp "$APK_OUT" "$WEB_DIR/express-manager.apk"
echo "  ✅ APK 已复制"

# ===== 5. Git 提交并推送 =====
echo ""
echo "📤 提交并推送代码..."
cd "$WEB_DIR"

# 检查是否有改动
if git diff --quiet && git diff --cached --quiet; then
  echo "  ⚠️  没有代码改动，跳过提交"
else
  git add -A
  git commit -m "v${VERSION_NAME}: ${CHANGELOG}"
  git push
  echo "  ✅ 代码已推送"
fi

# ===== 6. 创建 GitHub Release =====
echo ""
echo "🏷️  创建 GitHub Release v${VERSION_NAME}..."

# 格式化 changelog 为多行（用 \n 分隔）
RELEASE_BODY=$(echo "$CHANGELOG" | sed 's/\\n/\\n/g')

RELEASE_RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"tag_name\": \"v${VERSION_NAME}\",
    \"name\": \"v${VERSION_NAME} - ${CHANGELOG%%\\n*}\",
    \"body\": \"${RELEASE_BODY}\",
    \"draft\": false,
    \"prerelease\": false
  }" \
  "https://api.github.com/repos/${GITHUB_REPO}/releases")

RELEASE_ID=$(echo "$RELEASE_RESPONSE" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')

if [ -z "$RELEASE_ID" ]; then
  echo "❌ 创建 Release 失败"
  echo "$RELEASE_RESPONSE" | head -20
  exit 1
fi
echo "  ✅ Release 已创建 (ID: $RELEASE_ID)"

# ===== 7. 上传 APK =====
echo "📦 上传 APK..."
UPLOAD_RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"$WEB_DIR/express-manager.apk" \
  "https://uploads.github.com/repos/${GITHUB_REPO}/releases/${RELEASE_ID}/assets?name=express-manager.apk")

UPLOAD_STATE=$(echo "$UPLOAD_RESPONSE" | grep -o '"state": "[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')

if [ "$UPLOAD_STATE" != "uploaded" ]; then
  echo "❌ APK 上传失败"
  echo "$UPLOAD_RESPONSE" | head -20
  exit 1
fi
echo "  ✅ APK 已上传"

# ===== 完成 =====
echo ""
echo "=========================================="
echo "  🎉 发布成功！"
echo "=========================================="
echo "  版本: v${VERSION_NAME}"
echo "  Release: https://github.com/${GITHUB_REPO}/releases/tag/v${VERSION_NAME}"
echo "  APK: https://github.com/${GITHUB_REPO}/releases/download/v${VERSION_NAME}/express-manager.apk"
echo "=========================================="
