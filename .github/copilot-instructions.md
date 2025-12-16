## Project Structure

- [`packages/ema`](/packages/ema): The core for the EverMindAgent.
- [`packages/ema-ui`](/packages/ema-ui): The application for the EverMindAgent.

## Development Process

Both the core and application packages are developed using TypeScript.

- All of the public classes, methods, and variables should be documented with JSDoc.
- Write tests (vitest) in the `**/*.spec.ts` files.
- Format the code using `pnpm format` (Prettier).

1. **Write Code**
   - Follow the project's code style.
   - Add necessary comments and docstrings.
   - Keep your code clean and concise.

2. **Add Tests**
   - Add test cases for new features.
   - Ensure all tests pass:
     ```bash
     pnpm test
     ```

3. **Update Documentation**
   - If you add a new feature, update the README or relevant documentation.
   - Keep documentation in sync with your code.

4. **Commit Changes**
   - Use clear commit messages:
     ```bash
     git commit -m "feat(tools): add new file search tool"
     # or
     git commit -m "fix(agent): fix error handling for tool calls"
     ```
   - Commit message format:
     - `feat`: A new feature
     - `fix`: A bug fix
     - `docs`: Documentation updates
     - `style`: Code style adjustments
     - `refactor`: Code refactoring
     - `test`: Test-related changes
     - `chore`: Build or auxiliary tools

### Core Development

The core package focuses on providing the core functionality for the EverMindAgent frontend. It implements REST APIs for the frontend to interact with.

The core functionality includes:

- Implements the agent that chats with the user.
- Provides server endpoints by the class `Server` in [`packages/ema/src/server.ts`](/packages/ema/src/server.ts).

### Application Development

The application package focuses on providing a web-based GUI for the EverMindAgent framework. It is a Next.js application that can be started by running `pnpm start`.

- The server endpoints are exposed as REST APIs in the [`api`](/packages/ema-ui/src/app/api) folder.
