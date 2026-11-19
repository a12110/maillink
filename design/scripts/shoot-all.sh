#!/bin/zsh
# 用法：design/scripts/shoot-all.sh [页面名...]   不带参数截全部（浅/深各一套）。
# 依赖 oil-ui-pro 的 shoot.mjs，可用环境变量 SHOOT 指定路径。
# 结果写到 .oil-ui/ui-0/shots/（被忽略的过程目录），文件名 <页面>-<场景>-<light|dark>.png
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
node design/prototypes/build.mjs >/dev/null || exit 1
SHOOT=${SHOOT:-$HOME/.config/opencode/skills/oil-ui-pro/scripts/shoot.mjs}
OUT=.oil-ui/ui-0/shots
mkdir -p $OUT

shoot() { # 页面 视口 明暗 场景 [额外参数...]
  local page=$1 size=$2 theme=$3 tag=$4; shift 4
  local tmp; tmp=$(mktemp -d)
  node $SHOOT design/prototypes/$page.html --size $size --query "theme=$theme" --out $tmp --root . "$@" >$tmp/log.txt 2>&1
  local img; img=$(ls $tmp/*.png | head -1)
  mv "$img" $OUT/$page-$tag-$theme.png
  echo "== $page $tag $theme"; grep -E "提示|检查" $tmp/log.txt
}

pages=("$@"); [ ${#pages[@]} -eq 0 ] && pages=(mailboxes rule-group-edit pickup-code pickup-list pickup-states components)
for p in $pages; do
  for t in light dark; do
    case $p in
      mailboxes) shoot $p desktop $t desktop; shoot $p desktop $t hover --steps "hover: hover tbody tr:nth-child(4) td:nth-child(2); wait 250" ;;
      rule-group-edit) shoot $p desktop $t 1440; shoot $p 1280x800 $t 1280; shoot $p desktop $t 1440-full --full; shoot $p 1280x800 $t 1280-scrolled --steps "s: scroll 700; wait 300" ;;
      pickup-code) shoot $p mobile $t mobile; shoot $p mobile $t mobile-newmail --query "theme=$t&sim=new" --wait 900 ;;
      pickup-list) shoot $p mobile $t mobile; shoot $p desktop $t desktop ;;
      pickup-states) shoot $p mobile $t mobile-full --full; shoot $p desktop $t desktop-full --full ;;
      components) shoot $p desktop $t full --full ;;
    esac
  done
done
