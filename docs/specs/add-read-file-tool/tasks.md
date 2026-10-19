# 添加 read_file 工具

- [x] Task 1: 在 system-tools.ts 中实现 readFile 函数
    - 1.1: 添加文件大小常量（限制 1MB）
    - 1.2: 实现 readFile 函数，包含路径验证、文件大小检查、内容读取
    - 1.3: 导出 readFile 函数

- [x] Task 2: 在 tool-registry.ts 中注册 read_file 工具
    - 2.1: 添加 readFileSchema 验证器
    - 2.2: 注册 read_file 工具定义

- [x] Task 3: 验证构建
    - 3.1: 运行 tsc --noEmit 检查类型
    - 3.2: 运行 npm run build 验证构建
