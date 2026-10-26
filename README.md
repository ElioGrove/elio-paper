<center>
    <img src="https://raw.githubusercontent.com/ElioGrove/elio-paper/1f20bc8ca05cb74e6739ce21774f0ae07449ab13/favicon.svg" style="width: 100px;">
</center>


# Paper - Markdown 微信公众号编辑器

> Paper 是一款轻量级纯前端，单 html 文件可执行的微信公众号 Markdown 编辑器。现代化三栏布局，实时 Markdown 预览，响应式设计，支持多张图片横向滑动查看，支持信息卡片；支持大部分 Markdown 语法 (数学公式和 Mermaid除外,请在发布区进行手工渲染)，支持信息卡片。预览区与微信公众号编辑器等宽，所见即所得。欢迎使用👏！支持cloudflare pagesb部署。**定制属于每个人自己的微信公众号样式！**

![paper.png](https://img.thus.chat/rest/uX3Ngdk.png)


## 快速使用

1. 访问在线版 [paper.thus.chat](https://paper.thus.chat)
2. 下载 `html` 单文件到本地 chrome 直接打开运行
3. 下载 `html` 单文件部署到自己的服务器使用
4. 下载 `html` 单文件用 `AI` 修改成自己喜欢的样式后食用 
5. 免费部署到自己的 cloudflare pages，通过自己的域名访问。
    ![cf.png](https://img.thus.chat/rest/wipTgdk.png)


## 编辑器简介

[Paper 轻量级微信公众号 Markdown 编辑器 - 微信公众号文章简介](https://mp.weixin.qq.com/s/nbFNsOKvynUzzePMfkw79w)

### 核心特性

**1. 现代化三栏布局**
- **编辑区**：支持 Markdown 语法编写
- **预览区**：实时渲染，578px 宽度（与微信公众号编辑器等宽）
- **发布区**：提供一键复制和相关工具链接

**2. 微信公众号完美适配**
- 预览区严格按照微信公众号标准，预览区与微信公众号编辑器等宽（578px）
- 支持的样式完全兼容微信公众号平台
- 一键复制后可直接粘贴到公众号编辑器

**3. 丰富的功能支持**
- ✅ 基础 Markdown 语法（标题、段落、列表、表格等）
- ✅ 代码语法高亮（Kimbie Light 主题，Mac 风格）
- ✅ 自定义信息卡片（`:::info` 语法）
- ✅ 横屏滑动幻灯片（`<![alt](url),![alt](url)>` 语法）
- ✅ 同步滚动（编辑器与预览区联动）
- ❌ 数学公式（不支持，请使用发布区链接手工渲染）
- ❌ Mermaid 图表（不支持，请使用发布区链接手工渲染）


### 特色功能

**1. 信息卡片**
```markdown
:::info 提示标题
这里是卡片内容，支持**粗体**和*斜体*
:::
```

**2. 横屏滑动幻灯片**
```markdown
<![图片1](url1),![图片2](url2),![图片3](url3)>
```

**3. Mac 风格代码块**
- 自动添加 Mac 样式的三色圆点
- 支持多种编程语言语法高亮

### 使用场景

这个项目特别适合：
- 微信公众号内容创作者
- 单 Html 文件本地编辑器
- 追求简洁高效的 Markdown 编辑体验


## 更新记录

### 20251011
- 文件整理，bug 修复

### 20250906
- 已知 bug 修复

### 20250824
- 全新UI
- bug 修复

### 20250702
- 优化三级标题的显示样式
- 更新Markdown语法查询链接
- 编辑区和预览区时间显示修订

### 20250608
- 增加了两个卡片样式，浅橙色卡片和浅蓝色卡片，通过 `:::orange`、`:::blue` 来引用
- bug 修复，冗余代码删除

<!-- cloudflare-git-config:start -->
## Cloudflare Git 集成建议配置

核对日期：2026-10-26。

使用 **Cloudflare Pages / GitHub**，连接 `ElioGrove/elio-paper`。

| 配置项 | 建议值 |
| --- | --- |
| Pages 项目名称 | `elio-paper` |
| 生产分支 | `main` |
| 根目录 | `/`（仓库根目录） |
| 框架预设 | None；按下面的构建命令和产物路径填写 |
| 构建命令 | 留空（原生静态文件） |
| 构建输出目录 | `.` |
| 部署命令 | 无需填写，Pages 在构建后自动上传产物与 Functions |
| 启用预览构建 | 建议启用，非 main 分支自动生成预览 |
| 预览命令 | 无需填写；Pages 使用同一构建命令 |
| 构建监视路径 | 包含 `*`，排除项留空；确保空提交可触发验证 |

无需运行时变量、Secret 或存储绑定。

生产自定义域名：`paper.thus.chat`。原有默认域名 `paper-thus-chat.pages.dev` 保留；项目更名不会自动更换已分配的 pages.dev 子域。以自定义域名作为公开入口。

预览环境的变量、Secret 和绑定需独立配置；不要直接复制生产存储到可写的预览。

部署验证：推送 `main` 后，在 Pages → Deployments 找到同一提交 SHA，确认 build/deploy 均为 success；再访问自定义域名。可用 `git commit --allow-empty -m "chore: verify Cloudflare Git deployment"` 后 `git push origin main` 验证 Git 集成。

参考：[Pages Git 集成](https://developers.cloudflare.com/pages/configuration/git-integration/)、[构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)。

<!-- cloudflare-git-config:end -->
