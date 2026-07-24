# cc-runtime 源码工程

TypeScript + React 17 + antd 4。

```
仓库根目录/
    ├── src/                # 源码
    ├── native-host/        # Windows 剪贴板 Native Messaging（可选，用于 Creator 粘贴）
    ├── scripts/            # build / smoke / register-clipboard-host
    └── dist/               # 构建产物（加载此目录）
```

## 命令

```bash
npm install
npm run build         # → dist/
npm run smoke
```

Chrome「加载已解压的扩展程序」选择：`dist`

### 与 Cocos Creator 编辑器互粘组件（Windows）

面板内复制/粘贴不依赖此步骤。若要让「复制组件」写入 Creator 可识别的 `_dump_component_` 系统剪贴板格式：

1. 打开 `chrome://extensions`，复制本扩展 ID  
2. `node scripts/register-clipboard-host.mjs <extension-id>`  
3. 重新加载扩展后再复制组件  
