/* eslint-disable max-lines -- need to work with a lot of transactions in a switch statement */
/* eslint-disable max-lines-per-function -- need to work with a lot of Tx verifications */

import { ValidationError } from '../../errors'
import { convertTxFlagsToNumber } from '../utils/flags'

import { AccountDelete, validateAccountDelete } from './accountDelete'
import { AccountSet, validateAccountSet } from './accountSet'
import { AMMBid, validateAMMBid } from './AMMBid'
import { AMMClawback, validateAMMClawback } from './AMMClawback'
import { AMMCreate, validateAMMCreate } from './AMMCreate'
import { AMMDelete, validateAMMDelete } from './AMMDelete'
import { AMMDeposit, validateAMMDeposit } from './AMMDeposit'
import { AMMVote, validateAMMVote } from './AMMVote'
import { AMMWithdraw, validateAMMWithdraw } from './AMMWithdraw'
import { Batch, validateBatch } from './batch'
import { CheckCancel, validateCheckCancel } from './checkCancel'
import { CheckCash, validateCheckCash } from './checkCash'
import { CheckCreate, validateCheckCreate } from './checkCreate'
import { Clawback, validateClawback } from './clawback'
import {
  BaseTransaction,
  isIssuedCurrencyAmount,
  validateBaseTransaction,
} from './common'
import { CredentialAccept, validateCredentialAccept } from './CredentialAccept'
import { CredentialCreate, validateCredentialCreate } from './CredentialCreate'
import { CredentialDelete, validateCredentialDelete } from './CredentialDelete'
import { DelegateSet, validateDelegateSet } from './delegateSet'
import { DepositPreauth, validateDepositPreauth } from './depositPreauth'
import { DIDDelete, validateDIDDelete } from './DIDDelete'
import { DIDSet, validateDIDSet } from './DIDSet'
import { EnableAmendment } from './enableAmendment'
import { EscrowCancel, validateEscrowCancel } from './escrowCancel'
import { EscrowCreate, validateEscrowCreate } from './escrowCreate'
import { EscrowFinish, validateEscrowFinish } from './escrowFinish'
import { TransactionMetadata } from './metadata'
import { MPTokenAuthorize, validateMPTokenAuthorize } from './MPTokenAuthorize'
import {
  MPTokenIssuanceCreate,
  validateMPTokenIssuanceCreate,
} from './MPTokenIssuanceCreate'
import {
  MPTokenIssuanceDestroy,
  validateMPTokenIssuanceDestroy,
} from './MPTokenIssuanceDestroy'
import {
  MPTokenIssuanceSet,
  validateMPTokenIssuanceSet,
} from './MPTokenIssuanceSet'
import {
  NFTokenAcceptOffer,
  validateNFTokenAcceptOffer,
} from './NFTokenAcceptOffer'
import { NFTokenBurn, validateNFTokenBurn } from './NFTokenBurn'
import {
  NFTokenCancelOffer,
  validateNFTokenCancelOffer,
} from './NFTokenCancelOffer'
import {
  NFTokenCreateOffer,
  validateNFTokenCreateOffer,
} from './NFTokenCreateOffer'
import { NFTokenMint, validateNFTokenMint } from './NFTokenMint'
import { NFTokenModify, validateNFTokenModify } from './NFTokenModify'
import { OfferCancel, validateOfferCancel } from './offerCancel'
import { OfferCreate, validateOfferCreate } from './offerCreate'
import { OracleDelete, validateOracleDelete } from './oracleDelete'
import { OracleSet, validateOracleSet } from './oracleSet'
import { Payment, validatePayment } from './payment'
import {
  PaymentChannelClaim,
  validatePaymentChannelClaim,
} from './paymentChannelClaim'
import {
  PaymentChannelCreate,
  validatePaymentChannelCreate,
} from './paymentChannelCreate'
import {
  PaymentChannelFund,
  validatePaymentChannelFund,
} from './paymentChannelFund'
import {
  PermissionedDomainDelete,
  validatePermissionedDomainDelete,
} from './permissionedDomainDelete'
import {
  PermissionedDomainSet,
  validatePermissionedDomainSet,
} from './permissionedDomainSet'
import { SetFee } from './setFee'
import { SetRegularKey, validateSetRegularKey } from './setRegularKey'
import { SignerListSet, validateSignerListSet } from './signerListSet'
import { TicketCreate, validateTicketCreate } from './ticketCreate'
import { TrustSet, validateTrustSet } from './trustSet'
import { UNLModify } from './UNLModify'
import { VaultClawback, validateVaultClawback } from './vaultClawback'
import { VaultCreate, validateVaultCreate } from './vaultCreate'
import { VaultDelete, validateVaultDelete } from './vaultDelete'
import { VaultDeposit, validateVaultDeposit } from './vaultDeposit'
import { VaultSet, validateVaultSet } from './vaultSet'
import { VaultWithdraw, validateVaultWithdraw } from './vaultWithdraw'
import {
  XChainAccountCreateCommit,
  validateXChainAccountCreateCommit,
} from './XChainAccountCreateCommit'
import {
  XChainAddAccountCreateAttestation,
  validateXChainAddAccountCreateAttestation,
} from './XChainAddAccountCreateAttestation'
import {
  XChainAddClaimAttestation,
  validateXChainAddClaimAttestation,
} from './XChainAddClaimAttestation'
import { XChainClaim, validateXChainClaim } from './XChainClaim'
import { XChainCommit, validateXChainCommit } from './XChainCommit'
import {
  XChainCreateBridge,
  validateXChainCreateBridge,
} from './XChainCreateBridge'
import {
  XChainCreateClaimID,
  validateXChainCreateClaimID,
} from './XChainCreateClaimID'
import {
  XChainModifyBridge,
  validateXChainModifyBridge,
} from './XChainModifyBridge'

/**
 * Transactions that can be submitted by clients
 *
 * @category Transaction Models
 */
export type SubmittableTransaction =
  | AMMBid
  | AMMClawback
  | AMMCreate
  | AMMDelete
  | AMMDeposit
  | AMMVote
  | AMMWithdraw
  | AccountDelete
  | AccountSet
  | Batch
  | CheckCancel
  | CheckCash
  | CheckCreate
  | Clawback
  | CredentialAccept
  | CredentialCreate
  | CredentialDelete
  | DIDDelete
  | DIDSet
  | DelegateSet
  | DepositPreauth
  | EscrowCancel
  | EscrowCreate
  | EscrowFinish
  | MPTokenAuthorize
  | MPTokenIssuanceCreate
  | MPTokenIssuanceDestroy
  | MPTokenIssuanceSet
  | NFTokenAcceptOffer
  | NFTokenBurn
  | NFTokenCancelOffer
  | NFTokenCreateOffer
  | NFTokenMint
  | NFTokenModify
  | OfferCancel
  | OfferCreate
  | OracleDelete
  | OracleSet
  | Payment
  | PaymentChannelClaim
  | PaymentChannelCreate
  | PaymentChannelFund
  | PermissionedDomainSet
  | PermissionedDomainDelete
  | SetRegularKey
  | SignerListSet
  | TicketCreate
  | TrustSet
  | VaultClawback
  | VaultCreate
  | VaultDelete
  | VaultDeposit
  | VaultSet
  | VaultWithdraw
  | XChainAccountCreateCommit
  | XChainAddAccountCreateAttestation
  | XChainAddClaimAttestation
  | XChainClaim
  | XChainCommit
  | XChainCreateBridge
  | XChainCreateClaimID
  | XChainModifyBridge

/**
 * Transactions that can only be created by validators.
 *
 * @category Transaction Models
 */
export type PseudoTransaction = EnableAmendment | SetFee | UNLModify

/**
 * All transactions that can live on the XRPL
 *
 * @category Transaction Models
 */
export type Transaction = SubmittableTransaction | PseudoTransaction

/**
 * @category Transaction Models
 */
export interface TransactionAndMetadata<
  T extends BaseTransaction = Transaction,
> {
  transaction: T
  metadata: TransactionMetadata<T>
}

/**
 * Verifies various Transaction Types.
 * Encode/decode and individual type validation.
 *
 * @param transaction - A Transaction.
 * @throws ValidationError When the Transaction is malformed.
 * @category Utilities
 */
export function validate(transaction: Record<string, unknown>): void {
  const tx = { ...transaction }

  // should already be done in the tx-specific validation, but doesn't hurt to check again
  validateBaseTransaction(tx)

  Object.keys(tx).forEach((key) => {
    const standard_currency_code_len = 3
    const value = tx[key]
    if (value && isIssuedCurrencyAmount(value)) {
      const txCurrency = value.currency

      if (
        txCurrency.length === standard_currency_code_len &&
        txCurrency.toUpperCase() === 'XRP'
      ) {
        throw new ValidationError(
          `Cannot have an issued currency with a similar standard code to XRP (received '${txCurrency}'). XRP is not an issued currency.`,
        )
      }
    }
  })

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- okay here
  tx.Flags = convertTxFlagsToNumber(tx as unknown as Transaction)
  switch (tx.TransactionType) {
    case 'AMMBid':
      validateAMMBid(tx)
      break

    case 'AMMClawback':
      validateAMMClawback(tx)
      break

    case 'AMMCreate':
      validateAMMCreate(tx)
      break

    case 'AMMDelete':
      validateAMMDelete(tx)
      break

    case 'AMMDeposit':
      validateAMMDeposit(tx)
      break

    case 'AMMVote':
      validateAMMVote(tx)
      break

    case 'AMMWithdraw':
      validateAMMWithdraw(tx)
      break

    case 'AccountDelete':
      validateAccountDelete(tx)
      break

    case 'AccountSet':
      validateAccountSet(tx)
      break

    case 'Batch':
      validateBatch(tx)
      // This is done here to avoid issues with dependency cycles

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- okay here
      // @ts-expect-error -- already checked
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- already checked above
      tx.RawTransactions.forEach((innerTx: Record<string, unknown>) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- already checked above
        validate(innerTx.RawTransaction as Record<string, unknown>)
      })
      break

    case 'CheckCancel':
      validateCheckCancel(tx)
      break

    case 'CheckCash':
      validateCheckCash(tx)
      break

    case 'CheckCreate':
      validateCheckCreate(tx)
      break

    case 'Clawback':
      validateClawback(tx)
      break

    case 'CredentialAccept':
      validateCredentialAccept(tx)
      break

    case 'CredentialCreate':
      validateCredentialCreate(tx)
      break

    case 'CredentialDelete':
      validateCredentialDelete(tx)
      break

    case 'DIDDelete':
      validateDIDDelete(tx)
      break

    case 'DIDSet':
      validateDIDSet(tx)
      break

    case 'DelegateSet':
      validateDelegateSet(tx)
      break

    case 'DepositPreauth':
      validateDepositPreauth(tx)
      break

    case 'EscrowCancel':
      validateEscrowCancel(tx)
      break

    case 'EscrowCreate':
      validateEscrowCreate(tx)
      break

    case 'EscrowFinish':
      validateEscrowFinish(tx)
      break

    case 'MPTokenAuthorize':
      validateMPTokenAuthorize(tx)
      break

    case 'MPTokenIssuanceCreate':
      validateMPTokenIssuanceCreate(tx)
      break

    case 'MPTokenIssuanceDestroy':
      validateMPTokenIssuanceDestroy(tx)
      break

    case 'MPTokenIssuanceSet':
      validateMPTokenIssuanceSet(tx)
      break

    case 'NFTokenAcceptOffer':
      validateNFTokenAcceptOffer(tx)
      break

    case 'NFTokenBurn':
      validateNFTokenBurn(tx)
      break

    case 'NFTokenCancelOffer':
      validateNFTokenCancelOffer(tx)
      break

    case 'NFTokenCreateOffer':
      validateNFTokenCreateOffer(tx)
      break

    case 'NFTokenMint':
      validateNFTokenMint(tx)
      break

    case 'NFTokenModify':
      validateNFTokenModify(tx)
      break

    case 'OfferCancel':
      validateOfferCancel(tx)
      break

    case 'OfferCreate':
      validateOfferCreate(tx)
      break

    case 'OracleDelete':
      validateOracleDelete(tx)
      break

    case 'OracleSet':
      validateOracleSet(tx)
      break

    case 'Payment':
      validatePayment(tx)
      break

    case 'PaymentChannelClaim':
      validatePaymentChannelClaim(tx)
      break

    case 'PaymentChannelCreate':
      validatePaymentChannelCreate(tx)
      break

    case 'PaymentChannelFund':
      validatePaymentChannelFund(tx)
      break

    case 'PermissionedDomainSet':
      validatePermissionedDomainSet(tx)
      break

    case 'PermissionedDomainDelete':
      validatePermissionedDomainDelete(tx)
      break

    case 'SetRegularKey':
      validateSetRegularKey(tx)
      break

    case 'SignerListSet':
      validateSignerListSet(tx)
      break

    case 'TicketCreate':
      validateTicketCreate(tx)
      break

    case 'TrustSet':
      validateTrustSet(tx)
      break

    case 'VaultClawback':
      validateVaultClawback(tx)
      break

    case 'VaultCreate':
      validateVaultCreate(tx)
      break

    case 'VaultDelete':
      validateVaultDelete(tx)
      break

    case 'VaultDeposit':
      validateVaultDeposit(tx)
      break

    case 'VaultSet':
      validateVaultSet(tx)
      break

    case 'VaultWithdraw':
      validateVaultWithdraw(tx)
      break

    case 'XChainAccountCreateCommit':
      validateXChainAccountCreateCommit(tx)
      break

    case 'XChainAddAccountCreateAttestation':
      validateXChainAddAccountCreateAttestation(tx)
      break

    case 'XChainAddClaimAttestation':
      validateXChainAddClaimAttestation(tx)
      break

    case 'XChainClaim':
      validateXChainClaim(tx)
      break

    case 'XChainCommit':
      validateXChainCommit(tx)
      break

    case 'XChainCreateBridge':
      validateXChainCreateBridge(tx)
      break

    case 'XChainCreateClaimID':
      validateXChainCreateClaimID(tx)
      break

    case 'XChainModifyBridge':
      validateXChainModifyBridge(tx)
      break

    default:
      throw new ValidationError(
        `Invalid field TransactionType: ${tx.TransactionType}`,
      )
  }
}
