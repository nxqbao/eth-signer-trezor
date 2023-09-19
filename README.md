# @bahuy3103/eth-signer-trezor

`ethers` signer that derives address and signs transactions using Trezor device.
## Install
```bash
yarn add @bahuy3103/eth-signer-trezor
```

## Usage

```js
const hardwareWalletModule = require('@nxqbao/eth-signer-trezor');
const providers = require('ethers').providers;

const TrezorSigner = hardwareWalletModule.TrezorSigner;
const provider = new providers.JsonRpcProvider(providerUrl);
const derivationPath = `m/44'/60'/0'/0`;  // This follows BIP-44 wallet, without <index> in derivation path

/**
 * Specifying account by either index in account or by address, NOT both
 * 
 * const index = 0;
 * const address = undefined;
 **/
const index = undefined;
const address = "0xcB6a85e9Ff428d0cD7c6F3D7A03Aa5F6DF771525";
const sessionName = 'trezor user'

const ethersSigner = new TrezorSigner(
    provider,
    derivationPath,
    index,
    address,
    sessionName
);
```

## Implementation

The `TrezorSigner` class in [trezor-signer.ts](./src/trezor-signer.ts) satisfies following:
- extends `ethers.signer`
- loads and interacts with [Trezor Connect](https://github.com/trezor/connect)
- fetches public key by derivation path from Trezor and derives available addresses in the device

