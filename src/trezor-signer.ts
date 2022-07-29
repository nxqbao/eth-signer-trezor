import { utils, Signer, providers, UnsignedTransaction } from 'ethers'
import TrezorConnect, {
  Response,
  Unsuccessful,
  EthereumSignTransaction,
} from 'trezor-connect'
import { ConnectError } from './error'
import HDkey from 'hdkey';

const manifest = { 
  email: 'engineer@axieinfinity.com', 
  appUrl: 'https://www.skymavis.com/' 
}

const config = {
  manifest,
  popup: false,
  webusb: false,
  debug: false,
  lazyLoad: false
  // env: "node"
}

const HD_WALLET_PATH_BASE = `m`
const DEFAULT_HD_PATH_STRING = "m/44'/60'/0'/0" // TODO: handle <chainId>
const DEFAULT_SESSION_NAME = 'trezor-signer'

async function handleResponse <T> (p: Response<T>) {
  const response = await p;
  
  if (response.success) {
    return response.payload;
  }
  
  throw { 
    message: (response as Unsuccessful).payload.error, 
    code: (response as Unsuccessful).payload.code
  }
}

export class TrezorSigner extends Signer {
  private _path: string
  private _derivePath: string
  private _address?: string
  
  private _isInitialized: boolean
  private _isLoggedIn: boolean
  private _isPrepared: boolean

  private _sessionName: string
  private _hdk: HDkey
  private _pathTable: object
  
  readonly _reqIndex?: string | number
  readonly _reqAddress?: string

  constructor(
    provider?: providers.Provider,
    derivePath?: string,
    index?: number,
    address?: string,
    sessionName?: string
  ) {
    super();

    if (index && address) {
      throw new Error("Specify account by either wallet index or address. Default index is 0.")
    }

    if (!index && !address) {
      index = 0;
    }

    this._reqIndex = index
    this._reqAddress = address

    this._sessionName = sessionName || DEFAULT_SESSION_NAME;
    this._derivePath = derivePath || DEFAULT_HD_PATH_STRING;
    this._hdk = new HDkey();
    this._isInitialized = false
    this._isLoggedIn = false
    this._isPrepared = false
    this._pathTable = {}

    utils.defineReadOnly(this, 'provider', provider || null);
  }

  public async prepare(): Promise<any> {
    if (this._isPrepared) { return }

    this._isPrepared = true;

    await this.init();
    await this.login();
    await this.getAccountsFromDevice();

    if (this._reqAddress !== undefined) {
      this._address = this._reqAddress
      this._path = this.pathFromAddress(this._reqAddress)
    }

    if (this._reqIndex !== undefined) {
      this._path = this.concatWalletPath(this._reqIndex)
      this._address = this.addressFromIndex(HD_WALLET_PATH_BASE, this._reqIndex)
    }
  }

  public async init(): Promise<any> {
    if (this._isInitialized) { return }
    
    console.info("Init trezor...")
    this._isInitialized = true;
    return TrezorConnect.init(config);
  }

  public async login(): Promise<any> {
    if (this._isLoggedIn) { return }
    
    console.info("Login to trezor...")
    this._isLoggedIn = true; 
    
    // TODO: change to random handshake info
    const loginInfo = await TrezorConnect.requestLogin({
      challengeHidden: "0123456789abcdef",
      challengeVisual: `Login to ${this._sessionName}`
    })

    return loginInfo
  }

  private async getAccountsFromDevice(fromIndex: number = 0, toIndex: number = 10): Promise<any> {
    if (toIndex < 0 || fromIndex < 0) {
      throw new Error('Invalid from and to');
    }
    await this.setHdKey();

    const result = [];
    for (let i = fromIndex; i < toIndex; i++) {
      const address = this.addressFromIndex(HD_WALLET_PATH_BASE, i);
      result.push(address.toLowerCase());
      this._pathTable[utils.getAddress(address)] = i;
    }

    return result;
  }

  private async setHdKey(): Promise<any> {
    if (this._hdk.publicKey && this._hdk.chainCode) { return }

    const result = await this.getDerivePublicKey()
    this._hdk.publicKey = Buffer.from(result.publicKey, 'hex')
    this._hdk.chainCode = Buffer.from(result.chainCode, 'hex')
    return this._hdk
  }

  private async getDerivePublicKey(): Promise<HDkey> {
    return this.makeRequest(() => TrezorConnect.getPublicKey({ path: this._derivePath }))
  }
  
  public async getAddress(): Promise<string> {
    if (!this._address) {
      const result = await this.makeRequest(() =>(TrezorConnect.ethereumGetAddress({
        path: this._path
      })));
      this._address = (result.address || '').toLowerCase()
    }

    return this._address;
  }

  public async signMessage(message: string | utils.Bytes): Promise<string> {
    const result = await this.makeRequest(() => TrezorConnect.ethereumSignMessage({
      path: this._path,
      message: (message as string)
    }))
    
    return result.signature
  }

  public async signTransaction(
    transaction: utils.Deferrable<providers.TransactionRequest>
  ): Promise<string> {
    const tx = await utils.resolveProperties(transaction)

    const unsignedTx : UnsignedTransaction = {
      to: tx.to,
      nonce: parseInt(tx.nonce.toString()),
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      data: tx.data,
      value: tx.value,
      chainId: tx.chainId,
    }

    // TODO: handle tx.type
    // EIP-1559; Type 2
    if (tx.maxPriorityFeePerGas) unsignedTx.maxPriorityFeePerGas = tx.maxPriorityFeePerGas
    if (tx.maxFeePerGas) unsignedTx.maxFeePerGas = tx.maxFeePerGas

    const trezorTx : EthereumSignTransaction = {
      path: this._path,
      transaction: {
        to: (tx.to || '0x').toString(),
        value: utils.hexlify(tx.value || 0),
        gasPrice: utils.hexlify(tx.gasPrice || 0),
        gasLimit: utils.hexlify(tx.gasLimit || 0),
        nonce: utils.hexlify(tx.nonce),
        data: utils.hexlify(tx.data || '0x'),
        chainId: tx.chainId,
      }    
    }

    const {v,r,s} = await this.makeRequest(() => TrezorConnect.ethereumSignTransaction(trezorTx), 1)

    const signature = utils.joinSignature({
      r, 
      s,
      v: parseInt(v)
    })

    const signedTx = utils.serializeTransaction(
      unsignedTx,
      signature
    )

    return signedTx
  }

  public connect(provider: providers.Provider): TrezorSigner {
    return new TrezorSigner(provider, this._path);
  }

  public async _signTypedData(
    ...params: Parameters<providers.JsonRpcSigner["_signTypedData"]>
  ): Promise<string> {
    return   // TODO: _signTypedData
  }

  private addressFromIndex(pathBase: string, index: number | string): string {
    const derivedKey = this._hdk.derive(`${pathBase}/${index}`);
    const address = utils.computeAddress(derivedKey.publicKey);
    return utils.getAddress(address);
  }

  private pathFromAddress(address: string): string {
    const checksummedAddress = utils.getAddress(address);
    let index = this._pathTable[checksummedAddress];
    if (typeof index === 'undefined') {
      for (let i = 0; i < 1000; i++) {
        if (checksummedAddress === this.addressFromIndex(HD_WALLET_PATH_BASE, i)) {
          index = i;
          break;
        }
      }
    }

    if (typeof index === 'undefined') {
      throw new Error('Unknown address in trezor');
    }
    return this.concatWalletPath(index);
  }

  private concatWalletPath(index: string | number) {
    return `${this._derivePath}/${index.toString(10)}`
  }

  private async makeRequest <T> (fn: () => Response<T>, retries = 20) {
    try {
      await this.prepare()

      const result = await handleResponse(fn());
      return result
    } catch (e: unknown) {
      if (retries === 0) {
        throw new Error('Trezor unreachable, please try again')
      }

      const err = e as ConnectError

      if (err.code === 'Device_CallInProgress') {
        return new Promise<T>(resolve => {
          setTimeout(() => {
            console.warn('request conflict, trying again in 400ms', err)
            resolve(this.makeRequest(fn, retries - 1))
          }, 400)
        })
      } else {
        throw err
      }
    }
  }
}