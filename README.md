# cc-runtime 源码工程

TypeScript + React 17 + antd 4。

```
仓库根目录/
    ├── src/                # 源码
    ├── scripts/            # build / smoke
    └── dist/               # 构建产物（加载此目录）
```

## 命令

```bash
npm install
npm run build         # → dist/
npm run smoke
```

Chrome「加载已解压的扩展程序」选择：`dist`。打开页面后右下角有 **CC** 入口，点击即可打开侧边栏（也可点工具栏图标）。
