# 贡献指南

感谢您对 EverMindAgent 项目的关注!我们欢迎各种形式的贡献。

## 如何贡献

### 报告错误

如果您发现了错误,请创建一个 Issue 并包含以下信息:

- **问题描述**:清晰描述问题
- **重现步骤**:详细说明重现问题的步骤
- **预期行为**:您期望发生什么
- **实际行为**:实际发生了什么
- **环境信息**:
  - 操作系统
  - 浏览器及版本

### 建议新功能

如果您有新功能的想法,请先创建一个 Issue 进行讨论:

- 描述该功能的目的和价值
- 说明预期的使用场景
- 如果可能,提供设计方案

### 提交代码

#### 开始入门

1. Fork 本仓库
2. 克隆您的 fork:

   ```bash
   git clone https://github.com/EmaFanClub/EverMindAgent
   cd EverMindAgent
   ```

3. 创建新分支:

   ```bash
   git checkout -b feat/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

   这是可选的,但您可以查看并遵循 [Conventional Branch](https://conventional-branch.github.io/) 的分支命名格式。

4. 安装开发依赖:
   ```bash
   pnpm install
   ```

#### 开发流程

1. **编写代码**
   - 遵循项目的代码风格(参见[开发指南](docs/DEVELOPMENT_GUIDE.md#code-style-guide))
   - 添加必要的注释和文档字符串
   - 保持代码整洁简洁

2. **添加测试**
   - 为新功能添加测试用例
   - 确保所有测试通过:
     ```bash
     pnpm test
     ```

3. **更新文档**
   - 如果添加了新功能,请更新 README 或相关文档
   - 保持文档与代码同步

4. **提交更改**
   - 使用清晰的提交信息:
     ```bash
     git commit -m "feat(tools): add new file search tool"
     # 或
     git commit -m "fix(agent): fix error handling for tool calls"
     ```
   - 提交信息格式:
     - `feat`:新功能
     - `fix`:错误修复
     - `docs`:文档更新
     - `style`:代码风格调整
     - `refactor`:代码重构
     - `test`:测试相关更改
     - `chore`:构建或辅助工具

     查看并遵循 [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) 的提交信息格式。

5. **推送到您的 Fork**

   ```bash
   git push origin feat/your-feature-name
   ```

6. **创建 Pull Request**
   - 在 GitHub 上创建 Pull Request
   - 清晰描述您的更改
   - 如果适用,引用相关的 Issues

#### Pull Request 检查清单

在提交 PR 之前,请确保:

- [ ] 代码遵循项目的风格指南
- [ ] 所有测试通过
- [ ] 已添加必要的测试
- [ ] 已更新相关文档
- [ ] 提交信息清晰简洁
- [ ] 没有不相关的更改

### 代码审查

所有 Pull Request 都将被审查:

- 我们会尽快审查您的代码
- 我们可能会要求一些更改
- 请耐心并积极回应反馈
- 一旦获得批准,您的 PR 将被合并到主分支

## 代码风格指南

### 代码风格

使用 `pnpm format` 运行格式化和代码检查。

待办:在 IDE 和编辑器中设置代码检查工具。

### 测试

待办:测试相关内容。

## 社区准则

请遵循我们的[行为准则](CODE_OF_CONDUCT.md),保持友好和尊重。

## 问题和帮助

如果您有任何问题:

- 查看 [README](README.md) 和[文档](docs/)
- 搜索现有的 Issues
- 创建新的 Issue 提问

## 许可证

通过贡献,您同意您的贡献将在 [Apache License 2.0](LICENSE) 下授权。

***

再次感谢您的贡献!🎉

***
