# Contributing Guide

## Branch Management Strategy

### Branch Types

1. **main**: Production branch with stable code
2. **preview**: Pre-release branch for testing and validation
3. **dev**: Development branch integrating all feature developments
4. **feat/**: Work branches for new features
5. **fix/**: Work branches for bug fixes
6. **docs/**: Work branches for documentation updates
7. **refactor/**: Work branches for code restructuring
8. **chore/**: Work branches for maintenance tasks

### Development Workflow

#### 1. Create Work Branch

Pull the latest code from `dev` branch and create a typed work branch:

```bash
# Switch to dev branch
git checkout dev

# Pull latest code
git pull origin dev

# Create work branch (examples: feat/login, fix/login-error)
git checkout -b <type>/<description>
```

#### 2. Develop and Commit

Develop on the work branch and commit changes regularly:

```bash
# Add modified files
git add .

# Commit changes
git commit -m "feat: implement login functionality"

# Push branch to remote repository
git push origin <type>/<description>
```

#### 3. Create Pull Request

1. Go to the GitHub repository
2. Switch to your work branch
3. Click "Compare & pull request" button
4. Select `dev` as the target branch
5. Fill in PR title and description
6. Submit PR for review

#### 4. Code Review

- Team members will review your code
- Make changes based on feedback and resubmit
- Once approved, PR will be merged into `dev` branch

#### 5. Pre-release and Deployment

- When ready for release, create PR from `dev` to `preview` branch
- Perform testing and validation on `preview` branch
- After testing, create PR from `preview` to `main` branch
- Merging to `main` branch completes the release branch flow; perform production deployment using the project's current deployment process

### Branch Protection Rules

1. **main**: Only accepts PRs from `preview` branch
2. **preview**: Only accepts PRs from `dev` branch
3. **dev**: Only accepts PRs from typed work branches using one of `feat/*`, `fix/*`, `docs/*`, `refactor/*`, or `chore/*`. An optional owner prefix is allowed, for example `<owner>/fix/<description>`

### Commit Message Guidelines

Use the following prefixes to standardize commit messages:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation update
- `style:` Code format adjustment
- `refactor:` Code refactoring
- `test:` Testing related changes
- `chore:` Build/tooling related changes

Examples:
```
feat: implement user registration feature
fix: resolve login verification code expiration issue
docs: update API documentation
```

---

# 贡献指南

## 分支管理策略

### 分支类型

1. **main**：主分支，生产环境代码
2. **preview**：预发布分支，用于测试和验证
3. **dev**：开发分支，集成所有功能开发
4. **feat/**：用于开发新功能的工作分支
5. **fix/**：用于修复 bug 的工作分支
6. **docs/**：用于文档更新的工作分支
7. **refactor/**：用于代码重构的工作分支
8. **chore/**：用于维护任务的工作分支

### 开发流程

#### 1. 创建工作分支

从 `dev` 分支拉取最新代码并创建类型化工作分支：

```bash
# 切换到dev分支
git checkout dev

# 拉取最新代码
git pull origin dev

# 创建工作分支（示例：feat/login、fix/login-error）
git checkout -b <type>/<description>
```

#### 2. 开发和提交

在工作分支上进行开发，定期提交代码：

```bash
# 添加修改文件
git add .

# 提交代码
git commit -m "feat: 实现登录功能"

# 推送分支到远程仓库
git push origin <type>/<description>
```

#### 3. 创建Pull Request

1. 登录GitHub仓库
2. 切换到你创建的工作分支
3. 点击「Compare & pull request」按钮
4. 目标分支选择 `dev`
5. 填写PR标题和描述
6. 提交PR等待审核

#### 4. 代码审核

- 团队成员会审核你的代码
- 根据反馈修改代码并重新提交
- 审核通过后，PR会被合并到 `dev` 分支

#### 5. 预发布和上线

- 当需要发布新版本时，从 `dev` 分支创建PR到 `preview` 分支
- 在 `preview` 分支进行测试和验证
- 测试通过后，从 `preview` 分支创建PR到 `main` 分支
- 合并到 `main` 分支后，按照项目实际发布流程部署到生产环境

### 分支保护规则

1. **main**：仅接受来自 `preview` 分支的PR
2. **preview**：仅接受来自 `dev` 分支的PR
3. **dev**：仅接受来自类型化工作分支的PR，允许类型包括 `feat/*`、`fix/*`、`docs/*`、`refactor/*`、`chore/*`。允许添加所有者前缀，例如 `<owner>/fix/<description>`

### 提交信息规范

请使用以下前缀来规范提交信息：

- `feat:` 新功能
- `fix:` 修复bug
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 代码重构
- `test:` 测试相关
- `chore:` 构建/工具相关

示例：
```
feat: 实现用户注册功能
fix: 修复登录验证码过期问题
docs: 更新API文档
```