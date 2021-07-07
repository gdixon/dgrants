# dcgrants

## Development

This project is a monorepo with two packages:

- `contracts/` contains the smart contracts
- `app/` is a frontend

### Dependencies

To ensure that everyone is using the same version of nodejs on this project, [volta](https://volta.sh) is recommended!

### Set your env files

Copy `app/.env.template` to `app/.env` and edit, providing your own env vars

```bash
cp app/.env.template app/.env
```

Copy `contracts/.env.template` to `contracts/.env` and edit, providing your own env vars

```bash
cp contracts/.env.template contracts/.env

```

### Develop

```sh
yarn
yarn dev
```

### Lint

```sh
yarn lint
```

### Test

```sh
yarn test
```

### Build

```sh
yarn build
```

#### Note: Subdirectory Development

If you are working on one component or the other, you can `cd` into the appropriate subdirectory, and run commands defined in the corresponding `package.json` independently.

For example, to run smart contract tests only:

```bash
cd contracts
yarn test
```

or to start the frontend locally in development mode:

```bash
cd app
yarn dev
```
