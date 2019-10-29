const _ = require('lodash');
const assert = require('assert-diff');
const setupAPI = require('./setup-api');
const RippleAPI = require('ripple-api').RippleAPI;
const validate = RippleAPI._PRIVATE.validate;
const fixtures = require('./fixtures');
const requests = fixtures.requests;
const responses = fixtures.responses;
const addresses = require('./fixtures/addresses');
const hashes = require('./fixtures/hashes');
const address = addresses.ACCOUNT_X;
const utils = RippleAPI._PRIVATE.ledgerUtils;
const ledgerClosed = require('./fixtures/rippled/ledger-close-newer');
const schemaValidator = RippleAPI._PRIVATE.schemaValidator;
const binary = require('ripple-binary-codec');
const BigNumber = require('bignumber.js');
assert.options.strict = true;

// how long before each test case times out
const TIMEOUT = 20000;

function unused() {
}

function closeLedger(connection) {
  connection._ws.emit('message', JSON.stringify(ledgerClosed));
}

function checkResult(expected, schemaName, response) {
  if (expected.txJSON) {
    assert(response.txJSON);
    assert.deepEqual(JSON.parse(response.txJSON), JSON.parse(expected.txJSON));
  }
  if (expected.tx_json) {
    assert(response.tx_json);
    assert.deepEqual(response.tx_json, expected.tx_json);
  }
  assert.deepEqual(_.omit(response, 'txJSON'), _.omit(expected, 'txJSON'), _.omit(response, 'tx_json'), _.omit(response, 'tx_json'));
  if (schemaName) {
    schemaValidator.schemaValidate(schemaName, response);
  }
  return response;
}

describe('X-address Usage', function () {
  this.timeout(TIMEOUT);
  const instructionsWithMaxLedgerVersionOffset = { maxLedgerVersionOffset: 100 };
  beforeEach(setupAPI.setup);
  afterEach(setupAPI.teardown);

  it('error inspect', function () {
    const error = new this.api.errors.RippleError('mess', { data: 1 });
    assert.strictEqual(error.inspect(), '[RippleError(mess, { data: 1 })]');
  });

  describe('isValidAddress', function () {
    it('returns true for valid address', function () {
      assert(this.api.isValidAddress(addresses.ACCOUNT_X));
      assert(this.api.isValidAddress(addresses.ACCOUNT_T));
    })

    it('returns false for invalid address', function () {
      assert(!this.api.isValidAddress(addresses.ACCOUNT_X.slice(0, -1)));
      assert(!this.api.isValidAddress(addresses.ACCOUNT_T.slice(1)));
    })
  })

  describe('deriveAddress', function () {
    it('returns address for public key', function () {
      assert.equal(RippleAPI.deriveXAddress({
        publicKey: '035332FBA71D705BD5D97014A833BE2BBB25BEFCD3506198E14AFEA241B98C2D06',
        tag: false,
        test: false
      }), 'XVZVpQj8YSVpNyiwXYSqvQoQqgBttTxAZwMcuJd4xteQHyt');
      assert.equal(RippleAPI.deriveXAddress({
        publicKey: '035332FBA71D705BD5D97014A833BE2BBB25BEFCD3506198E14AFEA241B98C2D06',
        tag: false,
        test: true
      }), 'TVVrSWtmQQssgVcmoMBcFQZKKf56QscyWLKnUyiuZW8ALU4');
    })
  })

  describe('prepareTransaction - auto-fillable fields', function () {

    // Fee:

    it('does not overwrite Fee in txJSON', function () {
      const localInstructions = instructionsWithMaxLedgerVersionOffset

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '10'
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"10","Sequence":23}',
          instructions: {
            fee: '0.00001', // Notice there are not always 6 digits after the decimal point as trailing zeros are omitted
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('does not overwrite Fee in Instructions', function () {
      const localInstructions = _.defaults({
        fee: '0.000014', // CAUTION: This `fee` is specified in XRP, not drops.
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"14","Sequence":23}',
          instructions: {
            fee: '0.000014',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('rejects Promise if both are set, even when txJSON.Fee matches instructions.fee', function (done) {
      const localInstructions = _.defaults({
        fee: '0.000016'
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '16'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, '`Fee` in txJSON and `fee` in `instructions` cannot both be set');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise if both are set, when txJSON.Fee does not match instructions.fee', function (done) {
      const localInstructions = _.defaults({
        fee: '0.000018'
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '20'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, '`Fee` in txJSON and `fee` in `instructions` cannot both be set');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the Fee is capitalized in Instructions', function (done) {
      const localInstructions = _.defaults({
        Fee: '0.000022', // Intentionally capitalized in this test, but the correct field would be `fee`
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'instance additionalProperty "Fee" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the fee is specified in txJSON', function (done) {
      const localInstructions = instructionsWithMaxLedgerVersionOffset

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        fee: '10'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'txJSON additionalProperty "fee" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    // Sequence:

    it('does not overwrite Sequence in txJSON', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012'
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Sequence: 100
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":100}',
          instructions: {
            fee: '0.000012',
            sequence: 100,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('does not overwrite Sequence in Instructions', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012',
        sequence: 100
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":100}',
          instructions: {
            fee: '0.000012',
            sequence: 100,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('does not overwrite Sequence when same sequence is provided in both txJSON and Instructions', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012',
        sequence: 100
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Sequence: 100
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":100}',
          instructions: {
            fee: '0.000012',
            sequence: 100,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('rejects Promise when Sequence in txJSON does not match sequence in Instructions', function (done) {
      const localInstructions = _.defaults({
        maxFee: '0.000012',
        sequence: 100
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Sequence: 101
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, '`Sequence` in txJSON must match `sequence` in `instructions`');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the Sequence is capitalized in Instructions', function (done) {
      const localInstructions = _.defaults({
        maxFee: '0.000012',
        Sequence: 100 // Intentionally capitalized in this test, but the correct field would be `sequence`
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'instance additionalProperty "Sequence" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    // LastLedgerSequence aka maxLedgerVersion/maxLedgerVersionOffset:

    it('does not overwrite LastLedgerSequence in txJSON', function () {
      const localInstructions = {}

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '10',
        LastLedgerSequence: 8880000
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8880000,"Fee":"10","Sequence":23}',
          instructions: {
            fee: '0.00001', // Notice there are not always 6 digits after the decimal point as trailing zeros are omitted
            sequence: 23,
            maxLedgerVersion: 8880000
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('does not overwrite maxLedgerVersion in Instructions', function () {
      const localInstructions = {
        "maxLedgerVersion": 8890000
      }

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8890000,"Fee":"12","Sequence":23}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8890000
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('does not overwrite maxLedgerVersionOffset in Instructions', function () {
      const localInstructions = _.defaults({
        maxLedgerVersionOffset: 124
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820075,"Fee":"12","Sequence":23}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820075
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    })

    it('rejects Promise if txJSON.LastLedgerSequence and instructions.maxLedgerVersion both are set', function (done) {
      const localInstructions = {
        maxLedgerVersion: 8900000
      }

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '16',
        LastLedgerSequence: 8900000
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, '`LastLedgerSequence` in txJSON and `maxLedgerVersion` in `instructions` cannot both be set');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise if txJSON.LastLedgerSequence and instructions.maxLedgerVersionOffset both are set', function (done) {
      const localInstructions = _.defaults({
        maxLedgerVersionOffset: 123
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '16',
        LastLedgerSequence: 8900000
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, '`LastLedgerSequence` in txJSON and `maxLedgerVersionOffset` in `instructions` cannot both be set');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise if instructions.maxLedgerVersion and instructions.maxLedgerVersionOffset both are set', function (done) {
      const localInstructions = _.defaults({
        maxLedgerVersion: 8900000,
        maxLedgerVersionOffset: 123
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '16'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'instance is of prohibited type [object Object]');
          // A better error message would be: '`maxLedgerVersion` in `instructions` and `maxLedgerVersionOffset` in `instructions` cannot both be set'
          // Unfortunately, due to the schema validator, this is not possible without special-casing.
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise if txJSON.LastLedgerSequence and instructions.maxLedgerVersion and instructions.maxLedgerVersionOffset all are set', function (done) {
      const localInstructions = _.defaults({
        maxLedgerVersion: 8900000,
        maxLedgerVersionOffset: 123
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Fee: '16',
        LastLedgerSequence: 8900000
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'instance is of prohibited type [object Object]');
          // A better error message would be: 'At most one of the following can be set: `LastLedgerSequence` in txJSON, `maxLedgerVersion` in `instructions`, `maxLedgerVersionOffset` in `instructions`'
          // Unfortunately, due to the schema validator, this is not possible without special-casing.
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the maxLedgerVersion is capitalized in Instructions', function (done) {
      const localInstructions = _.defaults({
        MaxLedgerVersion: 8900000, // Intentionally capitalized in this test, but the correct field would be `maxLedgerVersion`
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'instance additionalProperty "MaxLedgerVersion" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the maxLedgerVersion is specified in txJSON', function (done) {
      const localInstructions = instructionsWithMaxLedgerVersionOffset

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        maxLedgerVersion: 8900000
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'txJSON additionalProperty "maxLedgerVersion" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the maxLedgerVersionOffset is specified in txJSON', function (done) {
      const localInstructions = instructionsWithMaxLedgerVersionOffset

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        maxLedgerVersionOffset: 8900000
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'txJSON additionalProperty "maxLedgerVersionOffset" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    it('rejects Promise when the sequence is specified in txJSON', function (done) {
      const localInstructions = instructionsWithMaxLedgerVersionOffset

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        sequence: 8900000
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'txJSON additionalProperty "sequence" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })

    // Paths: is not auto-filled by ripple-lib.

    // Other errors:

    it('rejects Promise when an unrecognized field is in Instructions', function (done) {
      const localInstructions = _.defaults({
        maxFee: '0.000012',
        foo: 'bar'
      }, instructionsWithMaxLedgerVersionOffset)

      const txJSON = {
        TransactionType: 'DepositPreauth',
        Account: address,
        Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
      }

      try {
        this.api.prepareTransaction(txJSON, localInstructions).then(response => {
          done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
        }).catch(err => {
          assert.strictEqual(err.name, 'ValidationError');
          assert.strictEqual(err.message, 'instance additionalProperty "foo" exists in instance when not allowed');
          done();
        }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
      } catch (err) {
        done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
      }
    })
  })

  it('rejects Promise when Account is missing', function (done) {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      TransactionType: 'DepositPreauth',
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    try {
      this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
      }).catch(err => {
        // assert.strictEqual(err.name, 'RippledError');
        // assert.strictEqual(err.message, 'Missing field \'account\'.');
        // assert.strictEqual(err.data.error, 'invalidParams');
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance requires property "Account"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  })

  it('rejects Promise when Account is not a string', function (done) {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: 1234,
      TransactionType: 'DepositPreauth',
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    try {
      this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.Account is not of a type(s) string,instance.Account is not exactly one from <xAddress>,<classicAddress>');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  })

  it('rejects Promise when Account is invalid', function (done) {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: 'rpZc4mVfWUif9CRoHRKKcmhu1nx2xkXXXX', // Invalid checksum
      TransactionType: 'DepositPreauth',
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    try {
      this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.Account is not exactly one from <xAddress>,<classicAddress>');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  })

  it('rejects Promise when Account is valid but non-existent on the ledger', function (done) {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: 'rogvkYnY8SWjxkJNgU4ZRVfLeRyt5DR9i',
      TransactionType: 'DepositPreauth',
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    try {
      this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
      }).catch(err => {
        assert.strictEqual(err.name, 'RippledError');
        assert.strictEqual(err.message, 'Account not found.');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  })

  it('rejects Promise when TransactionType is missing', function (done) {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: address,
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    try {
      this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
      }).catch(err => {
        // If not caught by ripple-lib validation, the rippled error looks like:
        // { error: 'invalidTransaction',
        //   error_exception: 'Field not found',
        //   id: 4,
        //   request:
        //     { command: 'submit',
        //       id: 4,
        //       tx_blob: '24000000032B7735940068400000000000000C732102E1EA8199F570E7F997A7B34EDFDA0A7D8B38173A17450B121A2EB048FDD16CA97446304402206CE34A79A44AEF15786F23DB25C8420E739C167E66750C0B7999EE4BF74A93A1022052E077A6435548F0EE0C5FE2EAB1E5A56376BA360F924DA2E162CCA6C7CB30CB8114D51F9A17208CF113AF23B97ECD5FCD314FBAE52E' },
        //   status: 'error',
        //   type: 'response' }
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance requires property "TransactionType"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  })

  // Note: This transaction will fail at the `sign` step:
  //
  //   Error: DepositPreXXXX is not a valid name or ordinal for TransactionType
  //
  // at Function.from (ripple-binary-codec/distrib/npm/enums/index.js:43:15)
  it('prepares tx when TransactionType is invalid', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: address,
      TransactionType: 'DepositPreXXXX',
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
      const expected = {
        txJSON: '{"TransactionType":"DepositPreXXXX","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":23}',
        instructions: {
          fee: '0.000012',
          sequence: 23,
          maxLedgerVersion: 8820051
        }
      }
      return checkResult(expected, 'prepare', response)
    })
  })

  it('rejects Promise when TransactionType is not a string', function (done) {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: address,
      TransactionType: 1234,
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    try {
      this.api.prepareTransaction(txJSON, localInstructions).then(response => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(response)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.TransactionType is not of a type(s) string');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  })

  // Note: This transaction is expected to fail at the `submit` step.
  it('prepares tx when a required field is missing', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      Account: address,
      TransactionType: 'DepositPreauth',
      // Authorize // Normally required, intentionally removed
    }

    return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
      const expected = {
        txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":23}',
        instructions: {
          fee: '0.000012',
          sequence: 23,
          maxLedgerVersion: 8820051
        }
      }
      return checkResult(expected, 'prepare', response)
    })
  })

  describe('preparePayment', function () {

    it('normal', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012'
      }, instructionsWithMaxLedgerVersionOffset);
      return this.api.preparePayment(
        address, requests.preparePayment.normal, localInstructions).then(
          _.partial(checkResult, responses.preparePayment.normal, 'prepare'));
    });

    it('preparePayment - min amount xrp', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012'
      }, instructionsWithMaxLedgerVersionOffset);
      return this.api.preparePayment(
        address, requests.preparePayment.minAmountXRP, localInstructions).then(
          _.partial(checkResult,
            responses.preparePayment.minAmountXRP, 'prepare'));
    });

    it('preparePayment - min amount xrp2xrp', function () {
      return this.api.preparePayment(
        address, requests.preparePayment.minAmount, instructionsWithMaxLedgerVersionOffset).then(
          _.partial(checkResult,
            responses.preparePayment.minAmountXRPXRP, 'prepare'));
    });

    it('preparePayment - XRP to XRP', function () {
      const payment = {
        "source": {
          "address": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
          "maxAmount": {
            "value": "1",
            "currency": "XRP"
          }
        },
        "destination": {
          "address": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
          "amount": {
            "value": "1",
            "currency": "XRP"
          }
        }
      }
      return this.api.preparePayment(address, payment, instructionsWithMaxLedgerVersionOffset).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"Payment","Account":"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59","Destination":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Amount":"1000000","Flags":2147483648,"LastLedgerSequence":8820051,"Sequence":23,"Fee":"12"}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    });

    it('preparePayment - XRP drops to XRP drops', function () {
      const payment = {
        "source": {
          "address": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
          "maxAmount": {
            "value": "1000000",
            "currency": "drops"
          }
        },
        "destination": {
          "address": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
          "amount": {
            "value": "1000000",
            "currency": "drops"
          }
        }
      }
      return this.api.preparePayment(address, payment, instructionsWithMaxLedgerVersionOffset).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"Payment","Account":"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59","Destination":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Amount":"1000000","Flags":2147483648,"LastLedgerSequence":8820051,"Sequence":23,"Fee":"12"}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    });

    it('preparePayment - XRP drops to XRP', function () {
      const payment = {
        "source": {
          "address": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
          "maxAmount": {
            "value": "1000000",
            "currency": "drops"
          }
        },
        "destination": {
          "address": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
          "amount": {
            "value": "1",
            "currency": "XRP"
          }
        }
      }
      return this.api.preparePayment(address, payment, instructionsWithMaxLedgerVersionOffset).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"Payment","Account":"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59","Destination":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Amount":"1000000","Flags":2147483648,"LastLedgerSequence":8820051,"Sequence":23,"Fee":"12"}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      })
    });

    it('preparePayment - XRP to XRP drops', function () {
      const payment = {
        "source": {
          "address": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
          "maxAmount": {
            "value": "1",
            "currency": "XRP"
          }
        },
        "destination": {
          "address": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
          "amount": {
            "value": "1000000",
            "currency": "drops"
          }
        }
      }
      return this.api.preparePayment(address, payment, instructionsWithMaxLedgerVersionOffset).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"Payment","Account":"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59","Destination":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Amount":"1000000","Flags":2147483648,"LastLedgerSequence":8820051,"Sequence":23,"Fee":"12"}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      });
    });

    it('preparePayment - uses source tag from source X-address', function () {
      const payment = {
        "source": {
          "address": "X7AcgcsBL6XDcUb289X4mJ8djcdyKaHMK8VcEc7y9YidxEB",
          "maxAmount": {
            "value": "1",
            "currency": "XRP"
          }
        },
        "destination": {
          "address": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
          "amount": {
            "value": "1000000",
            "currency": "drops"
          }
        }
      }
      return this.api.preparePayment(address, payment, instructionsWithMaxLedgerVersionOffset).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"Payment","Account":"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59","SourceTag":555,"Destination":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Amount":"1000000","Flags":2147483648,"LastLedgerSequence":8820051,"Sequence":23,"Fee":"12"}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      });
    });

    it('preparePayment - uses destination tag from destination X-address', function () {
      const payment = {
        "source": {
          "address": "X7AcgcsBL6XDcUb289X4mJ8djcdyKaHMK8VcEc7y9YidxEB",
          "maxAmount": {
            "value": "1",
            "currency": "XRP"
          }
        },
        "destination": {
          "address": "X7YenJqxv3L66CwhBSfd3N8RzGXxYq7on5EkithxQiva9wX",
          "amount": {
            "value": "1000000",
            "currency": "drops"
          }
        }
      }
      return this.api.preparePayment(address, payment, instructionsWithMaxLedgerVersionOffset).then(response => {
        const expected = {
          txJSON: '{"TransactionType":"Payment","Account":"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59","SourceTag":555,"Destination":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","DestinationTag":777,"Amount":"1000000","Flags":2147483648,"LastLedgerSequence":8820051,"Sequence":23,"Fee":"12"}',
          instructions: {
            fee: '0.000012',
            sequence: 23,
            maxLedgerVersion: 8820051
          }
        }
        return checkResult(expected, 'prepare', response)
      });
    });

    describe('errors', function () {

      const senderAddress = 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59';
      const recipientAddress = 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex';

      it('rejects promise and does not throw when payment object is invalid', function (done) {
        const payment = {
          source: {
            address: senderAddress,
            amount: { // instead of `maxAmount`
              value: '1000',
              currency: 'drops'
            }
          },
          destination: {
            address: recipientAddress,
            amount: {
              value: '1000',
              currency: 'drops'
            }
          }
        }
        // Cannot use `assert.rejects` because then the test passes (with UnhandledPromiseRejectionWarning) even when it should not.
        // See https://github.com/mochajs/mocha/issues/3097
        try {
          this.api.preparePayment(senderAddress, payment).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'payment must specify either (source.maxAmount and destination.amount) or (source.amount and destination.minAmount)');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });

      it('rejects promise and does not throw when field is missing', function (done) {
        const payment = {
          source: {
            address: senderAddress
            // `maxAmount` missing
          },
          destination: {
            address: recipientAddress,
            amount: {
              value: '1000',
              currency: 'drops'
            }
          }
        }
        // Cannot use `assert.rejects` because then the test passes (with UnhandledPromiseRejectionWarning) even when it should not.
        // See https://github.com/mochajs/mocha/issues/3097
        try {
          this.api.preparePayment(senderAddress, payment).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'instance.payment.source is not exactly one from <sourceExactAdjustment>,<maxAdjustment>');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });

      it('rejects promise and does not throw when fee exceeds maxFeeXRP', function (done) {
        const payment = {
          source: {
            address: senderAddress,
            maxAmount: {
              value: '1000',
              currency: 'drops'
            }
          },
          destination: {
            address: recipientAddress,
            amount: {
              value: '1000',
              currency: 'drops'
            }
          }
        }
        // Cannot use `assert.rejects` because then the test passes (with UnhandledPromiseRejectionWarning) even when it should not.
        // See https://github.com/mochajs/mocha/issues/3097
        try {
          this.api.preparePayment(senderAddress, payment, {
            fee: '3' // XRP
          }).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'Fee of 3 XRP exceeds max of 2 XRP. To use this fee, increase `maxFeeXRP` in the RippleAPI constructor.');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });

      it('preparePayment - XRP to XRP no partial', function (done) {
        try {
          // Cannot return promise because we want/expect it to reject.
          this.api.preparePayment(address, requests.preparePayment.wrongPartial).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'XRP to XRP payments cannot be partial payments');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });
  
      it('preparePayment - address must match payment.source.address', function (done) {
        try {
          // Cannot return promise because we want/expect it to reject.
          this.api.preparePayment(address, requests.preparePayment.wrongAddress).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'address must match payment.source.address');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });

      it('preparePayment - mismatched X-address tag', function (done) {
        try {
          // Cannot return promise because we want/expect it to reject.
          this.api.preparePayment(address, {
            "source": {
              "address": "X7AcgcsBL6XDcUb289X4mJ8djcdyKaHcqA3bkjhpzdaYpQr",
              "amount": {
                "value": "0.01",
                "currency": "USD",
                "counterparty": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
              },
              "tag": 321
            },
            "destination": {
              "address": "rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo",
              "minAmount": {
                "value": "0.01",
                "currency": "XRP"
              }
            }
          }).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'address includes a tag that does not match the tag specified in the transaction');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });

      it('preparePayment - mismatched X-address account', function (done) {
        try {
          // Cannot return promise because we want/expect it to reject.
          this.api.preparePayment(address, {
            "source": {
              "address": "rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo",
              "amount": {
                "value": "0.01",
                "currency": "USD",
                "counterparty": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
              }
            },
            "destination": {
              "address": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM",
              "minAmount": {
                "value": "0.01",
                "currency": "XRP"
              }
            }
          }).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'address must match payment.source.address');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });
  
      it('preparePayment - wrong amount', function (done) {
        try {
          // Cannot return promise because we want/expect it to reject.
          this.api.preparePayment(address, requests.preparePayment.wrongAmount).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'payment must specify either (source.maxAmount and destination.amount) or (source.amount and destination.minAmount)');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });
  
      it('preparePayment - throws when fee exceeds 2 XRP', function (done) {
        const localInstructions = _.defaults({
          fee: '2.1'
        }, instructionsWithMaxLedgerVersionOffset);
  
        try {
          // Cannot return promise because we want/expect it to reject.
          this.api.preparePayment(
            address, requests.preparePayment.normal, localInstructions).then(prepared => {
            done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
          }).catch(err => {
            assert.strictEqual(err.name, 'ValidationError');
            assert.strictEqual(err.message, 'Fee of 2.1 XRP exceeds max of 2 XRP. To use this fee, increase `maxFeeXRP` in the RippleAPI constructor.');
            done();
          }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
        } catch (err) {
          done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
        }
      });
    });

    it('preparePayment with all options specified', function () {
      return this.api.getLedgerVersion().then(ver => {
        const localInstructions = {
          maxLedgerVersion: ver + 100,
          fee: '0.000012'
        };
        return this.api.preparePayment(
          'X7AcgcsBL6XDcUb289X4mJ8djcdyKaGo2K5VpXpmCqbV2gS', // source tag of 14
          requests.preparePayment.allOptions, localInstructions).then(
            _.partial(checkResult,
              responses.preparePayment.allOptions, 'prepare'));
      });
    });

    it('preparePayment without counterparty set', function () {
      const localInstructions = _.defaults({ sequence: 23 }, instructionsWithMaxLedgerVersionOffset);
      return this.api.preparePayment(
        'X7AcgcsBL6XDcUb289X4mJ8djcdyKaGo2K5VpXpmCqbV2gS', // source tag of 14
        requests.preparePayment.noCounterparty, localInstructions)
        .then(_.partial(checkResult, responses.preparePayment.noCounterparty,
          'prepare'));
    });

    it('preparePayment - destination.minAmount', function () {
      return this.api.preparePayment(address, responses.getPaths.sendAll[0],
        instructionsWithMaxLedgerVersionOffset).then(_.partial(checkResult,
          responses.preparePayment.minAmount, 'prepare'));
    });

    it('preparePayment - caps fee at 2 XRP by default', function () {
      this.api._feeCushion = 1000000;

      const expectedResponse = {
        "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"2000000\",\"Sequence\":23}",
        "instructions": {
          "fee": "2",
          "sequence": 23,
          "maxLedgerVersion": 8820051
        }
      }

      return this.api.preparePayment(
        address, requests.preparePayment.normal, instructionsWithMaxLedgerVersionOffset).then(
          _.partial(checkResult, expectedResponse, 'prepare'));
    });

    it('preparePayment - allows fee exceeding 2 XRP when maxFeeXRP is higher', function () {
      this.api._maxFeeXRP = '2.2'
      const localInstructions = _.defaults({
        fee: '2.1'
      }, instructionsWithMaxLedgerVersionOffset);

      const expectedResponse = {
        "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"2100000\",\"Sequence\":23}",
        "instructions": {
          "fee": "2.1",
          "sequence": 23,
          "maxLedgerVersion": 8820051
        }
      }

      return this.api.preparePayment(
        address, requests.preparePayment.normal, localInstructions).then(
          _.partial(checkResult, expectedResponse, 'prepare'));
    });
  });

  it('prepareOrder - buy order', function () {
    const request = requests.prepareOrder.buy;
    return this.api.prepareOrder(address, request)
      .then(_.partial(checkResult, responses.prepareOrder.buy, 'prepare'));
  });

  it('prepareOrder - buy order with expiration', function () {
    const request = requests.prepareOrder.expiration;
    const response = responses.prepareOrder.expiration;
    return this.api.prepareOrder(address, request, instructionsWithMaxLedgerVersionOffset)
      .then(_.partial(checkResult, response, 'prepare'));
  });

  it('prepareOrder - sell order', function () {
    const request = requests.prepareOrder.sell;
    return this.api.prepareOrder(address, request, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareOrder.sell, 'prepare'));
  });

  it('prepareOrder - invalid', function (done) {
    const request = Object.assign({}, requests.prepareOrder.sell);
    delete request.direction; // Make invalid
    try {
      this.api.prepareOrder(address, request, instructionsWithMaxLedgerVersionOffset).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.order requires property "direction"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareOrderCancellation', function () {
    const request = requests.prepareOrderCancellation.simple;
    return this.api.prepareOrderCancellation(address, request, instructionsWithMaxLedgerVersionOffset)
      .then(_.partial(checkResult, responses.prepareOrderCancellation.normal,
        'prepare'));
  });

  it('prepareOrderCancellation - no instructions', function () {
    const request = requests.prepareOrderCancellation.simple;
    return this.api.prepareOrderCancellation(address, request)
      .then(_.partial(checkResult,
        responses.prepareOrderCancellation.noInstructions,
        'prepare'));
  });

  it('prepareOrderCancellation - with memos', function () {
    const request = requests.prepareOrderCancellation.withMemos;
    return this.api.prepareOrderCancellation(address, request)
      .then(_.partial(checkResult,
        responses.prepareOrderCancellation.withMemos,
        'prepare'));
  });

  it('prepareOrderCancellation - invalid', function (done) {
    const request = Object.assign({}, requests.prepareOrderCancellation.withMemos);
    delete request.orderSequence; // Make invalid
    try {
      this.api.prepareOrderCancellation(address, request).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.orderCancellation requires property "orderSequence"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareTrustline - simple', function () {
    return this.api.prepareTrustline(
      address, requests.prepareTrustline.simple, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult, responses.prepareTrustline.simple, 'prepare'));
  });

  it('prepareTrustline - frozen', function () {
    return this.api.prepareTrustline(
      address, requests.prepareTrustline.frozen).then(
        _.partial(checkResult, responses.prepareTrustline.frozen, 'prepare'));
  });

  it('prepareTrustline - complex', function () {
    return this.api.prepareTrustline(
      address, requests.prepareTrustline.complex, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult, responses.prepareTrustline.complex, 'prepare'));
  });

  it('prepareTrustline - invalid', function (done) {
    const trustline = Object.assign({}, requests.prepareTrustline.complex);
    delete trustline.limit; // Make invalid
    try {
      this.api.prepareTrustline(
        address, trustline, instructionsWithMaxLedgerVersionOffset).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.trustline requires property "limit"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareSettings', function () {
    return this.api.prepareSettings(
      address, requests.prepareSettings.domain, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult, responses.prepareSettings.flags, 'prepare'));
  });

  it('prepareSettings - no maxLedgerVersion', function () {
    return this.api.prepareSettings(
      address, requests.prepareSettings.domain, { maxLedgerVersion: null }).then(
        _.partial(checkResult, responses.prepareSettings.noMaxLedgerVersion,
          'prepare'));
  });

  it('prepareSettings - no instructions', function () {
    return this.api.prepareSettings(
      address, requests.prepareSettings.domain).then(
        _.partial(
          checkResult,
          responses.prepareSettings.noInstructions,
          'prepare'));
  });

  it('prepareSettings - regularKey', function () {
    const regularKey = { regularKey: 'rAR8rR8sUkBoCZFawhkWzY4Y5YoyuznwD' };
    return this.api.prepareSettings(address, regularKey, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.regularKey, 'prepare'));
  });

  it('prepareSettings - remove regularKey', function () {
    const regularKey = { regularKey: null };
    return this.api.prepareSettings(address, regularKey, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.removeRegularKey,
        'prepare'));
  });

  it('prepareSettings - flag set', function () {
    const settings = { requireDestinationTag: true };
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.flagSet, 'prepare'));
  });

  it('prepareSettings - flag clear', function () {
    const settings = { requireDestinationTag: false };
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.flagClear, 'prepare'));
  });

  it('prepareSettings - set depositAuth flag', function () {
    const settings = { depositAuth: true };
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.flagSetDepositAuth, 'prepare'));
  });

  it('prepareSettings - clear depositAuth flag', function () {
    const settings = { depositAuth: false };
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.flagClearDepositAuth, 'prepare'));
  });

  it('prepareSettings - integer field clear', function () {
    const settings = { transferRate: null };
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset)
      .then(data => {
        assert(data);
        assert.strictEqual(JSON.parse(data.txJSON).TransferRate, 0);
      });
  });

  it('prepareSettings - set transferRate', function () {
    const settings = { transferRate: 1 };
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.setTransferRate,
        'prepare'));
  });

  it('prepareSettings - set signers', function () {
    const settings = requests.prepareSettings.signers.normal;
    return this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(
      _.partial(checkResult, responses.prepareSettings.signers,
        'prepare'));
  });

  it('prepareSettings - signers no threshold', function (done) {
    const settings = requests.prepareSettings.signers.noThreshold;
    try {
      this.api.prepareSettings(address, settings, instructionsWithMaxLedgerVersionOffset).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.settings.signers requires property "threshold"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareSettings - signers no weights', function () {
    const settings = requests.prepareSettings.signers.noWeights;
    const localInstructions = _.defaults({
      signersCount: 1
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.prepareSettings(
      address, settings, localInstructions).then(
        _.partial(checkResult, responses.prepareSettings.noWeights,
          'prepare'));
  });

  it('prepareSettings - fee for multisign', function () {
    const localInstructions = _.defaults({
      signersCount: 4
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.prepareSettings(
      address, requests.prepareSettings.domain, localInstructions).then(
        _.partial(checkResult, responses.prepareSettings.flagsMultisign,
          'prepare'));
  });

  it('prepareSettings - no signer list', function () {
    const settings = requests.prepareSettings.noSignerEntries;
    const localInstructions = _.defaults({
      signersCount: 1
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.prepareSettings(
      address, settings, localInstructions).then(
        _.partial(checkResult, responses.prepareSettings.noSignerList,
          'prepare'));
  });

  it('prepareSettings - invalid', function (done) {
    // domain must be a string
    const settings = Object.assign({},
      requests.prepareSettings.domain,
      {domain: 123});

    const localInstructions = _.defaults({
      signersCount: 4
    }, instructionsWithMaxLedgerVersionOffset);

    try {
      this.api.prepareSettings(
        address, settings, localInstructions).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.settings.domain is not of a type(s) string');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareEscrowCreation', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.prepareEscrowCreation(
      address, requests.prepareEscrowCreation.normal,
      localInstructions).then(
        _.partial(checkResult, responses.prepareEscrowCreation.normal,
          'prepare'));
  });

  it('prepareEscrowCreation full', function () {
    return this.api.prepareEscrowCreation(
      'X7AcgcsBL6XDcUb289X4mJ8djcdyKaGZMhc9YTE92ehJ2Fu', requests.prepareEscrowCreation.full).then(
        _.partial(checkResult, responses.prepareEscrowCreation.full,
          'prepare'));
  });

  it('prepareEscrowCreation - invalid', function (done) {
    const escrow = Object.assign({}, requests.prepareEscrowCreation.full);
    delete escrow.amount; // Make invalid
    try {
      this.api.prepareEscrowCreation(
        address, escrow).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, 'instance.escrowCreation requires property "amount"');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareEscrowExecution', function () {
    return this.api.prepareEscrowExecution(
      address,
      requests.prepareEscrowExecution.normal, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult,
          responses.prepareEscrowExecution.normal,
          'prepare'));
  });

  it('prepareEscrowExecution - simple', function () {
    return this.api.prepareEscrowExecution(
      address,
      requests.prepareEscrowExecution.simple).then(
        _.partial(checkResult,
          responses.prepareEscrowExecution.simple,
          'prepare'));
  });

  it('prepareEscrowExecution - no condition', function (done) {
    try {
      this.api.prepareEscrowExecution(address,
        requests.prepareEscrowExecution.noCondition, instructionsWithMaxLedgerVersionOffset).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, '"condition" and "fulfillment" fields on EscrowFinish must only be specified together.');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareEscrowExecution - no fulfillment', function (done) {
    try {
      this.api.prepareEscrowExecution(address,
        requests.prepareEscrowExecution.noFulfillment, instructionsWithMaxLedgerVersionOffset).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, '"condition" and "fulfillment" fields on EscrowFinish must only be specified together.');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('prepareEscrowCancellation', function () {
    return this.api.prepareEscrowCancellation(
      address,
      requests.prepareEscrowCancellation.normal, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult,
          responses.prepareEscrowCancellation.normal,
          'prepare'));
  });

  it('prepareEscrowCancellation with memos', function () {
    return this.api.prepareEscrowCancellation(
      address,
      requests.prepareEscrowCancellation.memos).then(
        _.partial(checkResult,
          responses.prepareEscrowCancellation.memos,
          'prepare'));
  });

  it('prepareCheckCreate', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.prepareCheckCreate(
      address, requests.prepareCheckCreate.normal,
      localInstructions).then(
        _.partial(checkResult, responses.prepareCheckCreate.normal,
          'prepare'));
  });

  it('prepareCheckCreate full', function () {
    return this.api.prepareCheckCreate(
      address, requests.prepareCheckCreate.full).then(
        _.partial(checkResult, responses.prepareCheckCreate.full,
          'prepare'));
  });

  it('prepareCheckCash amount', function () {
    return this.api.prepareCheckCash(
      address, requests.prepareCheckCash.amount).then(
        _.partial(checkResult, responses.prepareCheckCash.amount,
          'prepare'));
  });

  it('prepareCheckCash deliverMin', function () {
    return this.api.prepareCheckCash(
      address, requests.prepareCheckCash.deliverMin).then(
        _.partial(checkResult, responses.prepareCheckCash.deliverMin,
          'prepare'));
  });

  it('prepareCheckCancel', function () {
    return this.api.prepareCheckCancel(
      address, requests.prepareCheckCancel.normal).then(
        _.partial(checkResult, responses.prepareCheckCancel.normal,
          'prepare'));
  });

  it('prepareTransaction - DepositPreauth - Authorize', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      TransactionType: 'DepositPreauth',
      Account: address,
      Authorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
      const expected = {
        txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Authorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":23}',
        instructions: {
          fee: '0.000012',
          sequence: 23,
          maxLedgerVersion: 8820051
        }
      }
      return checkResult(expected, 'prepare', response)
    })
  })

  it('prepareTransaction - DepositPreauth - Unauthorize', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset)

    const txJSON = {
      TransactionType: 'DepositPreauth',
      Account: address,
      Unauthorize: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex'
    }

    return this.api.prepareTransaction(txJSON, localInstructions).then(response => {
      const expected = {
        txJSON: '{"TransactionType":"DepositPreauth","Account":"' + addresses.ACCOUNT + '","Unauthorize":"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo","Flags":2147483648,"LastLedgerSequence":8820051,"Fee":"12","Sequence":23}',
        instructions: {
          fee: '0.000012',
          sequence: 23,
          maxLedgerVersion: 8820051
        }
      }
      return checkResult(expected, 'prepare', response)
    })
  })

  describe('prepareTransaction - Payment', function () {

    it('normal', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012'
      }, instructionsWithMaxLedgerVersionOffset);

      const txJSON = {
        TransactionType: 'Payment',
        Account: address,
        Destination: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Amount: {
          currency: 'USD',
          issuer: 'rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM',
          value: '0.01'
        },
        SendMax: {
          currency: 'USD',
          issuer: 'rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM',
          value: '0.01'
        },
        Flags: 0
      }

      return this.api.prepareTransaction(txJSON, localInstructions).then(
          _.partial(checkResult, responses.preparePayment.normal, 'prepare'));
    });

    // prepareTransaction - Payment
    it('min amount xrp', function () {
      const localInstructions = _.defaults({
        maxFee: '0.000012'
      }, instructionsWithMaxLedgerVersionOffset);

      const txJSON = {
        TransactionType: 'Payment',
        Account: address,
        Destination: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',

        // Max amount to send. Use 100 billion XRP to
        // ensure that we send the full SendMax amount.
        Amount: '100000000000000000',

        SendMax: {
          currency: 'USD',
          issuer: 'rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM',
          value: '0.01'
        },
        DeliverMin: '10000',
        Flags: this.api.txFlags.Payment.PartialPayment
      }
      
      return this.api.prepareTransaction(txJSON, localInstructions).then(
          _.partial(checkResult,
            responses.preparePayment.minAmountXRP, 'prepare'));
    });

    // prepareTransaction - Payment
    it('min amount xrp2xrp', function () {
      const txJSON = {
        TransactionType: 'Payment',
        Account: address,
        Destination: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex',
        Amount: '10000',
        Flags: 0
      }
      return this.api.prepareTransaction(txJSON, instructionsWithMaxLedgerVersionOffset).then(
          _.partial(checkResult,
            responses.preparePayment.minAmountXRPXRP, 'prepare'));
    });

    // prepareTransaction - Payment
    it('with all options specified', function () {
      return this.api.getLedgerVersion().then(ver => {
        const localInstructions = {
          maxLedgerVersion: ver + 100,
          fee: '0.000012'
        };
        const txJSON = {
          TransactionType: 'Payment',
          Account: 'X7AcgcsBL6XDcUb289X4mJ8djcdyKaGo2K5VpXpmCqbV2gS', // tag of 14
          Destination: 'X7YenJqxv3L66CwhBSfd3N8RzGXxYqV56ZkTCa9UCzgaao1', // tag of 58
          Amount: '10000',
          InvoiceID: 'A98FD36C17BE2B8511AD36DC335478E7E89F06262949F36EB88E2D683BBCC50A',
          SourceTag: 14,
          DestinationTag: 58,
          Memos: [
            {
              Memo: {
                MemoType: this.api.convertStringToHex('test'),
                MemoFormat: this.api.convertStringToHex('text/plain'),
                MemoData: this.api.convertStringToHex('texted data')
              }
            }
          ],
          Flags: 0 | this.api.txFlags.Payment.NoRippleDirect | this.api.txFlags.Payment.LimitQuality
        }
        return this.api.prepareTransaction(txJSON, localInstructions).then(
            _.partial(checkResult,
              responses.preparePayment.allOptions, 'prepare'));
      });
    });

    // prepareTransaction - Payment
    it('fee is capped at default maxFee of 2 XRP (using txJSON.LastLedgerSequence)', function () {
      this.api._feeCushion = 1000000;

      const txJSON = {
        "Flags": 2147483648,
        "TransactionType": "Payment",
        "Account": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
        "Destination": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
        "Amount": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "SendMax": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "LastLedgerSequence": 8820051
      }

      const localInstructions = {}
  
      const expectedResponse = {
        "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"2000000\",\"Sequence\":23}",
        "instructions": {
          "fee": "2",
          "sequence": 23,
          "maxLedgerVersion": 8820051
        }
      }
  
      return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult,
          expectedResponse, 'prepare'));
    });

    // prepareTransaction - Payment
    it('fee is capped at default maxFee of 2 XRP (using instructions.maxLedgerVersion)', function () {
      this.api._feeCushion = 1000000;

      const txJSON = {
        "Flags": 2147483648,
        "TransactionType": "Payment",
        "Account": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
        "Destination": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
        "Amount": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "SendMax": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        }
      }

      const localInstructions = {
        "maxLedgerVersion": 8820051
      }
  
      const expectedResponse = {
        "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"2000000\",\"Sequence\":23}",
        "instructions": {
          "fee": "2",
          "sequence": 23,
          "maxLedgerVersion": 8820051
        }
      }
  
      return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult,
          expectedResponse, 'prepare'));
    });
  
    // prepareTransaction - Payment
    it('fee is capped to custom maxFeeXRP when maxFee exceeds maxFeeXRP', function () {
      this.api._feeCushion = 1000000
      this.api._maxFeeXRP = '3'
      const localInstructions = {
        maxFee: '4' // We are testing that this does not matter; fee is still capped to maxFeeXRP
      };

      const txJSON = {
        "Flags": 2147483648,
        "TransactionType": "Payment",
        "Account": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
        "Destination": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
        "Amount": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "SendMax": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "LastLedgerSequence": 8820051
      }
  
      const expectedResponse = {
        "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"3000000\",\"Sequence\":23}",
        "instructions": {
          "fee": "3",
          "sequence": 23,
          "maxLedgerVersion": 8820051
        }
      }    
  
      return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult,
          expectedResponse, 'prepare'));
    });
  
    // prepareTransaction - Payment
    it('fee is capped to maxFee', function () {
      this.api._feeCushion = 1000000
      this.api._maxFeeXRP = '5'
      const localInstructions = {
        maxFee: '4' // maxFeeXRP does not matter if maxFee is lower than maxFeeXRP
      };

      const txJSON = {
        "Flags": 2147483648,
        "TransactionType": "Payment",
        "Account": "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
        "Destination": "X7YenJqxv3L66CwhBSfd3N8RzGXxYqPopMGMsCcpho79rex",
        "Amount": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "SendMax": {
          "value": "0.01",
          "currency": "USD",
          "issuer": "rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM"
        },
        "LastLedgerSequence": 8820051,
      }
  
      const expectedResponse = {
        "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"4000000\",\"Sequence\":23}",
        "instructions": {
          "fee": "4",
          "sequence": 23,
          "maxLedgerVersion": 8820051
        }
      }    
  
      return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult,
          expectedResponse, 'prepare'));
    });
  });

  it('prepareTransaction - PaymentChannelCreate', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.prepareTransaction({
      Account: address,
      TransactionType: 'PaymentChannelCreate',
      Amount: '1000000', // 1 XRP in drops. Use a string-encoded integer.
      Destination: 'rsA2LpzuawewSBQXkiju3YQTMzW13pAAdW',
      SettleDelay: 86400,
      PublicKey: '32D2471DB72B27E3310F355BB33E339BF26F8392D5A93D3BC0FC3B566612DA0F0A'
      // If cancelAfter is used, you must use RippleTime.
      // You can use `iso8601ToRippleTime()` to convert to RippleTime.

      // Other fields are available (but not used in this test),
      // including `sourceTag` and `destinationTag`.
    }, localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelCreate.normal,
          'prepare'));
  });

  it('prepareTransaction - PaymentChannelCreate full', function () {
    const txJSON = {
      Account: 'X7AcgcsBL6XDcUb289X4mJ8djcdyKaLFuhLRuNXPrDeJd9A',
      TransactionType: 'PaymentChannelCreate',
      Amount: this.api.xrpToDrops('1'), // or '1000000'
      Destination: 'X7d3eHCXzwBeWrZec1yT24iZerQjYL8m8zCJ16ACxu1BrBY',
      SettleDelay: 86400,

      // Ensure this is in upper case if it is not already
      PublicKey: '32D2471DB72B27E3310F355BB33E339BF26F8392D5A93D3BC0FC3B566612DA0F0A'.toUpperCase(),

      CancelAfter: this.api.iso8601ToRippleTime('2017-02-17T15:04:57Z'),
      SourceTag: 11747,
      DestinationTag: 23480
    }
  
    return this.api.prepareTransaction(txJSON).then(
        _.partial(checkResult, responses.preparePaymentChannelCreate.full,
          'prepare'));
  });

  it('prepareTransaction - PaymentChannelFund', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);

    const txJSON = {
      Account: address,
      TransactionType: 'PaymentChannelFund',
      Channel: 'C1AE6DDDEEC05CF2978C0BAD6FE302948E9533691DC749DCDD3B9E5992CA6198',
      Amount: this.api.xrpToDrops('1') // or '1000000'
    }

    return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelFund.normal,
          'prepare'));
  });

  it('prepareTransaction - PaymentChannelFund full', function () {
    const txJSON = {
      Account: address,
      TransactionType: 'PaymentChannelFund',
      Channel: 'C1AE6DDDEEC05CF2978C0BAD6FE302948E9533691DC749DCDD3B9E5992CA6198',
      Amount: this.api.xrpToDrops('1'), // or '1000000'
      Expiration: this.api.iso8601ToRippleTime('2017-02-17T15:04:57Z')
    }

    return this.api.prepareTransaction(txJSON).then(
        _.partial(checkResult, responses.preparePaymentChannelFund.full,
          'prepare'));
  });

  it('prepareTransaction - PaymentChannelClaim', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);

    const txJSON = {
      Account: address,
      TransactionType: 'PaymentChannelClaim',
      Channel: 'C1AE6DDDEEC05CF2978C0BAD6FE302948E9533691DC749DCDD3B9E5992CA6198',
      Flags: 0
    }

    return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelClaim.normal,
          'prepare'));
  });

  it('prepareTransaction - PaymentChannelClaim with renew', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);

    const txJSON = {
      Account: address,
      TransactionType: 'PaymentChannelClaim',
      Channel: 'C1AE6DDDEEC05CF2978C0BAD6FE302948E9533691DC749DCDD3B9E5992CA6198',
      Balance: this.api.xrpToDrops('1'), // or '1000000'
      Amount: this.api.xrpToDrops('1'), // or '1000000'
      Signature: '30440220718D264EF05CAED7C781FF6DE298DCAC68D002562C9BF3A07C1E721B420C0DAB02203A5A4779EF4D2CCC7BC3EF886676D803A9981B928D3B8ACA483B80ECA3CD7B9B',
      PublicKey: '32D2471DB72B27E3310F355BB33E339BF26F8392D5A93D3BC0FC3B566612DA0F0A',
      Flags: 0
    }
    txJSON.Flags |= this.api.txFlags.PaymentChannelClaim.Renew

    return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelClaim.renew,
          'prepare'));
  });

  it('prepareTransaction - PaymentChannelClaim with close', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);

    const txJSON = {
      Account: address,
      TransactionType: 'PaymentChannelClaim',
      Channel: 'C1AE6DDDEEC05CF2978C0BAD6FE302948E9533691DC749DCDD3B9E5992CA6198',
      Balance: this.api.xrpToDrops('1'), // or 1000000
      Amount: this.api.xrpToDrops('1'), // or 1000000
      Signature: '30440220718D264EF05CAED7C781FF6DE298DCAC68D002562C9BF3A07C1E721B420C0DAB02203A5A4779EF4D2CCC7BC3EF886676D803A9981B928D3B8ACA483B80ECA3CD7B9B',
      PublicKey: '32D2471DB72B27E3310F355BB33E339BF26F8392D5A93D3BC0FC3B566612DA0F0A',
      Flags: 0
    }
    txJSON.Flags |= this.api.txFlags.PaymentChannelClaim.Close
  
    return this.api.prepareTransaction(txJSON, localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelClaim.close,
          'prepare'));
  });

  it('preparePaymentChannelCreate', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.preparePaymentChannelCreate(
      address, requests.preparePaymentChannelCreate.normal,
      localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelCreate.normal,
          'prepare'));
  });

  it('preparePaymentChannelCreate full', function () {
    return this.api.preparePaymentChannelCreate(
      'X7AcgcsBL6XDcUb289X4mJ8djcdyKaLFuhLRuNXPrDeJd9A', requests.preparePaymentChannelCreate.full).then(
        _.partial(checkResult, responses.preparePaymentChannelCreate.full,
          'prepare'));
  });

  it('preparePaymentChannelFund', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.preparePaymentChannelFund(
      address, requests.preparePaymentChannelFund.normal,
      localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelFund.normal,
          'prepare'));
  });

  it('preparePaymentChannelFund full', function () {
    return this.api.preparePaymentChannelFund(
      address, requests.preparePaymentChannelFund.full).then(
        _.partial(checkResult, responses.preparePaymentChannelFund.full,
          'prepare'));
  });

  it('preparePaymentChannelClaim', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.preparePaymentChannelClaim(
      address, requests.preparePaymentChannelClaim.normal,
      localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelClaim.normal,
          'prepare'));
  });

  it('preparePaymentChannelClaim with renew', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.preparePaymentChannelClaim(
      address, requests.preparePaymentChannelClaim.renew,
      localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelClaim.renew,
          'prepare'));
  });

  it('preparePaymentChannelClaim with close', function () {
    const localInstructions = _.defaults({
      maxFee: '0.000012'
    }, instructionsWithMaxLedgerVersionOffset);
    return this.api.preparePaymentChannelClaim(
      address, requests.preparePaymentChannelClaim.close,
      localInstructions).then(
        _.partial(checkResult, responses.preparePaymentChannelClaim.close,
          'prepare'));
  });

  it('rejects Promise on preparePaymentChannelClaim with renew and close', function (done) {
    try {
      this.api.preparePaymentChannelClaim(
        address, requests.preparePaymentChannelClaim.full).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, '"renew" and "close" flags on PaymentChannelClaim are mutually exclusive');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('rejects Promise on preparePaymentChannelClaim with no signature', function (done) {
    try {
      this.api.preparePaymentChannelClaim(
        address, requests.preparePaymentChannelClaim.noSignature).then(prepared => {
        done(new Error('Expected method to reject. Prepared transaction: ' + JSON.stringify(prepared)));
      }).catch(err => {
        assert.strictEqual(err.name, 'ValidationError');
        assert.strictEqual(err.message, '"signature" and "publicKey" fields on PaymentChannelClaim must only be specified together.');
        done();
      }).catch(done); // Finish test with assertion failure immediately instead of waiting for timeout.
    } catch (err) {
      done(new Error('Expected method to reject, but method threw. Thrown: ' + err));
    }
  });

  it('sign', function () {
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const result = this.api.sign(requests.sign.normal.txJSON, secret);
    assert.deepEqual(result, responses.sign.normal);
    schemaValidator.schemaValidate('sign', result);
  });

  it('sign - already signed', function () {
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const result = this.api.sign(requests.sign.normal.txJSON, secret);
    assert.throws(() => {
      const tx = JSON.stringify(binary.decode(result.signedTransaction));
      this.api.sign(tx, secret);
    }, /txJSON must not contain "TxnSignature" or "Signers" properties/);
  });

  it('sign - EscrowExecution', function () {
    const secret = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
    const result = this.api.sign(requests.sign.escrow.txJSON, secret);
    assert.deepEqual(result, responses.sign.escrow);
    schemaValidator.schemaValidate('sign', result);
  });

  it('sign - signAs', function () {
    const txJSON = requests.sign.signAs;
    const secret = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
    const signature = this.api.sign(JSON.stringify(txJSON), secret,
      { signAs: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' });
    assert.deepEqual(signature, responses.sign.signAs);
  });

  it('sign - withKeypair', function () {
    const keypair = {
      privateKey:
        '00ACCD3309DB14D1A4FC9B1DAE608031F4408C85C73EE05E035B7DC8B25840107A',
      publicKey:
        '02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8'
    };
    const result = this.api.sign(requests.sign.normal.txJSON, keypair);
    assert.deepEqual(result, responses.sign.normal);
    schemaValidator.schemaValidate('sign', result);
  });

  it('sign - withKeypair already signed', function () {
    const keypair = {
      privateKey:
        '00ACCD3309DB14D1A4FC9B1DAE608031F4408C85C73EE05E035B7DC8B25840107A',
      publicKey:
        '02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8'
    };
    const result = this.api.sign(requests.sign.normal.txJSON, keypair);
    assert.throws(() => {
      const tx = JSON.stringify(binary.decode(result.signedTransaction));
      this.api.sign(tx, keypair);
    }, /txJSON must not contain "TxnSignature" or "Signers" properties/);
  });

  it('sign - withKeypair EscrowExecution', function () {
    const keypair = {
      privateKey:
        '001ACAAEDECE405B2A958212629E16F2EB46B153EEE94CDD350FDEFF52795525B7',
      publicKey:
        '0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020'
    };
    const result = this.api.sign(requests.sign.escrow.txJSON, keypair);
    assert.deepEqual(result, responses.sign.escrow);
    schemaValidator.schemaValidate('sign', result);
  });

  it('sign - withKeypair signAs', function () {
    const txJSON = requests.sign.signAs;
    const keypair = {
      privateKey:
        '001ACAAEDECE405B2A958212629E16F2EB46B153EEE94CDD350FDEFF52795525B7',
      publicKey:
        '0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020'
    };
    const signature = this.api.sign(JSON.stringify(txJSON), keypair, {
      signAs: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
    });
    assert.deepEqual(signature, responses.sign.signAs);
  });

  it('sign - succeeds - prepared payment', async function () {
    const payment = await this.api.preparePayment('r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59', {
      source: {
        address: 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59',
        maxAmount: {
          value: '1',
          currency: 'drops'
        }
      },
      destination: {
        address: 'rQ3PTWGLCbPz8ZCicV5tCX3xuymojTng5r',
        amount: {
          value: '1',
          currency: 'drops'
        }
      }
    });
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const result = this.api.sign(payment.txJSON, secret);
    const expectedResult = {
      signedTransaction:
      '12000022800000002400000017201B008694F261400000000000000168400000000000000C732102F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D874473045022100A9C91D4CFAE45686146EE0B56D4C53A2E7C2D672FB834D43E0BE2D2E9106519A022075DDA2F92DE552B0C45D83D4E6D35889B3FBF51BFBBD9B25EBF70DE3C96D0D6681145E7B112523F68D2F5E879DB4EAC51C6698A693048314FDB08D07AAA0EB711793A3027304D688E10C3648',
     id:
      '88D6B913C66279EA31ADC25C5806C48B2D4E5680261666790A736E1961217700'
    };
    assert.deepEqual(result, expectedResult);
    schemaValidator.schemaValidate('sign', result);
  });

  it('sign - succeeds - no flags', async function () {
    const txJSON = '{"TransactionType":"Payment","Account":"r45Rev1EXGxy2hAUmJPCne97KUE7qyrD3j","Destination":"rQ3PTWGLCbPz8ZCicV5tCX3xuymojTng5r","Amount":"20000000","Sequence":1,"Fee":"12"}';
    const secret = 'shotKgaEotpcYsshSE39vmSnBDRim';
    const result = this.api.sign(txJSON, secret);
    const expectedResult = {
      signedTransaction:
      '1200002400000001614000000001312D0068400000000000000C7321022B05847086686F9D0499B13136B94AD4323EE1B67D4C429ECC987AB35ACFA34574473045022100C104B7B97C31FACA4597E7D6FCF13BD85BD11375963A62A0AC45B0061236E39802207784F157F6A98DFC85B051CDDF61CC3084C4F5750B82674801C8E9950280D1998114EE3046A5DDF8422C40DDB93F1D522BB4FE6419158314FDB08D07AAA0EB711793A3027304D688E10C3648',
     id:
      '0596925967F541BF332FF6756645B2576A9858414B5B363DC3D34915BE8A70D6'
    };
    const decoded = binary.decode(result.signedTransaction);
    assert(decoded.Flags === undefined, `Flags = ${decoded.Flags}, should be undefined`);
    assert.deepEqual(result, expectedResult);
    schemaValidator.schemaValidate('sign', result);
  });

  it('sign - throws when encoded tx does not match decoded tx - prepared payment', async function () {
    const payment = await this.api.preparePayment('r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59', {
      source: {
        address: 'r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59',
        maxAmount: {
          value: '1.1234567',
          currency: 'drops'
        }
      },
      destination: {
        address: 'rQ3PTWGLCbPz8ZCicV5tCX3xuymojTng5r',
        amount: {
          value: '1.1234567',
          currency: 'drops'
        }
      }
    });
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    assert.throws(
      () => {
        this.api.sign(payment.txJSON, secret);
      },
      /^Error: 1\.1234567 is an illegal amount/
    );
  });

  it('sign - throws when encoded tx does not match decoded tx - prepared order', async function () {
    const order = {
      direction: 'sell',
      quantity: {
        currency: 'USD',
        counterparty: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
        value: '3.140000'
      },
      totalPrice: {
        currency: 'XRP',
        value: '31415'
      }
    };
    const prepared = await this.api.prepareOrder('r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59', order, {
      sequence: 123
    });
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    try {
      this.api.sign(prepared.txJSON, secret);
      return Promise.reject(new Error('api.sign should have thrown'));
    } catch (error) {
      assert.equal(error.name, 'ValidationError');
      assert.equal(error.message, 'Serialized transaction does not match original txJSON. See `error.data`');
      assert.deepEqual(error.data.diff, {
        TakerGets: {
          value: '3.14'
        }
      });
    }
  });

  it('sign - throws when encoded tx does not match decoded tx - AccountSet', function () {
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const request = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"AccountSet\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Domain\":\"726970706C652E636F6D\",\"LastLedgerSequence\":8820051,\"Fee\":\"1.2\",\"Sequence\":23,\"SigningPubKey\":\"02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8\"}",
      "instructions": {
        "fee": "0.0000012",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }
    
    assert.throws(
      () => {
        this.api.sign(request.txJSON, secret);
      },
      /Error: 1\.2 is an illegal amount/
    );
  });

  it('sign - throws when encoded tx does not match decoded tx - higher fee', function () {
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const request = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"AccountSet\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Domain\":\"726970706C652E636F6D\",\"LastLedgerSequence\":8820051,\"Fee\":\"1123456.7\",\"Sequence\":23,\"SigningPubKey\":\"02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8\"}",
      "instructions": {
        "fee": "1.1234567",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }
    
    assert.throws(
      () => {
        this.api.sign(request.txJSON, secret);
      },
      /Error: 1123456\.7 is an illegal amount/
    );
  });

  it('sign - throws when Fee exceeds maxFeeXRP (in drops)', function () {
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const request = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"AccountSet\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Domain\":\"726970706C652E636F6D\",\"LastLedgerSequence\":8820051,\"Fee\":\"2010000\",\"Sequence\":23,\"SigningPubKey\":\"02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8\"}",
      "instructions": {
        "fee": "2.01",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }
    
    assert.throws(() => {
      this.api.sign(request.txJSON, secret)
    }, /Fee" should not exceed "2000000"\. To use a higher fee, set `maxFeeXRP` in the RippleAPI constructor\./)
  });

  it('sign - throws when Fee exceeds maxFeeXRP (in drops) - custom maxFeeXRP', function () {
    this.api._maxFeeXRP = '1.9'
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const request = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"AccountSet\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Domain\":\"726970706C652E636F6D\",\"LastLedgerSequence\":8820051,\"Fee\":\"2010000\",\"Sequence\":23,\"SigningPubKey\":\"02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8\"}",
      "instructions": {
        "fee": "2.01",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }
    
    assert.throws(() => {
      this.api.sign(request.txJSON, secret)
    }, /Fee" should not exceed "1900000"\. To use a higher fee, set `maxFeeXRP` in the RippleAPI constructor\./)
  });

  it('sign - permits fee exceeding 2000000 drops when maxFeeXRP is higher than 2 XRP', function () {
    this.api._maxFeeXRP = '2.1'
    const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
    const request = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"AccountSet\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Domain\":\"726970706C652E636F6D\",\"LastLedgerSequence\":8820051,\"Fee\":\"2010000\",\"Sequence\":23,\"SigningPubKey\":\"02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8\"}",
      "instructions": {
        "fee": "2.01",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }

    const result = this.api.sign(request.txJSON, secret)

    const expectedResponse =  {
      signedTransaction: "12000322800000002400000017201B008695536840000000001EAB90732102F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8744630440220384FBB48EEE7B0E58BD89294A609F9407C51FBE8FA08A4B305B22E9A7489D66602200152315EFE752DA381E74493419871550D206AC6503841DA5F8C30E35D9E3892770A726970706C652E636F6D81145E7B112523F68D2F5E879DB4EAC51C6698A69304",
      id: "A1586D6AF7B0821E7075E12A0132D9EB50BC1874A0749441201497F7561795FB"
    }

    assert.deepEqual(result, expectedResponse)
    schemaValidator.schemaValidate('sign', result)
  });

  it('submit', function () {
    return this.api.submit(responses.sign.normal.signedTransaction).then(response => {
      checkResult(responses.submit, 'submit', response);
    });
  });

  it('submit - failure', function () {
    return this.api.submit('BAD').then(() => {
      assert(false, 'Should throw RippledError');
    }).catch(error => {
      assert(error instanceof this.api.errors.RippledError);
      assert.strictEqual(error.data.resultCode, 'temBAD_FEE');
    });
  });

  it('signPaymentChannelClaim', function () {
    const privateKey =
      'ACCD3309DB14D1A4FC9B1DAE608031F4408C85C73EE05E035B7DC8B25840107A';
    const result = this.api.signPaymentChannelClaim(
      requests.signPaymentChannelClaim.channel,
      requests.signPaymentChannelClaim.amount, privateKey);
    checkResult(responses.signPaymentChannelClaim,
      'signPaymentChannelClaim', result)
  });

  it('verifyPaymentChannelClaim', function () {
    const publicKey =
      '02F89EAEC7667B30F33D0687BBA86C3FE2A08CCA40A9186C5BDE2DAA6FA97A37D8';
    const result = this.api.verifyPaymentChannelClaim(
      requests.signPaymentChannelClaim.channel,
      requests.signPaymentChannelClaim.amount,
      responses.signPaymentChannelClaim, publicKey);
    checkResult(true, 'verifyPaymentChannelClaim', result)
  });

  it('verifyPaymentChannelClaim - invalid', function () {
    const publicKey =
      '03A6523FE4281DA48A6FD77FAF3CB77F5C7001ABA0B32BCEDE0369AC009758D7D9';
    const result = this.api.verifyPaymentChannelClaim(
      requests.signPaymentChannelClaim.channel,
      requests.signPaymentChannelClaim.amount,
      responses.signPaymentChannelClaim, publicKey);
    checkResult(false,
      'verifyPaymentChannelClaim', result)
  });

  it('combine', function () {
    const combined = this.api.combine(requests.combine.setDomain);
    checkResult(responses.combine.single, 'sign', combined);
  });

  it('combine - different transactions', function () {
    const request = [requests.combine.setDomain[0]];
    const tx = binary.decode(requests.combine.setDomain[0]);
    tx.Flags = 0;
    request.push(binary.encode(tx));
    assert.throws(() => {
      this.api.combine(request);
    }, /txJSON is not the same for all signedTransactions/);
  });

  describe('RippleAPI', function () {

    it('getBalances', function () {
      return this.api.getBalances(address).then(
        _.partial(checkResult, responses.getBalances, 'getBalances'));
    });

    it('getBalances - limit', function () {
      const options = {
        limit: 3,
        ledgerVersion: 123456
      };
      const expectedResponse = responses.getBalances.slice(0, 3);
      return this.api.getBalances(address, options).then(
        _.partial(checkResult, expectedResponse, 'getBalances'));
    });

    it('getBalances - limit & currency', function () {
      const options = {
        currency: 'USD',
        limit: 3
      };
      const expectedResponse = _.filter(responses.getBalances,
        item => item.currency === 'USD').slice(0, 3);
      return this.api.getBalances(address, options).then(
        _.partial(checkResult, expectedResponse, 'getBalances'));
    });

    it('getBalances - limit & currency & issuer', function () {
      const options = {
        currency: 'USD',
        counterparty: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
        limit: 3
      };
      const expectedResponse = _.filter(responses.getBalances,
        item => item.currency === 'USD' &&
          item.counterparty === 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B').slice(0, 3);
      return this.api.getBalances(address, options).then(
        _.partial(checkResult, expectedResponse, 'getBalances'));
    });
  });

  it('getBalanceSheet', function () {
    return this.api.getBalanceSheet(address).then(
      _.partial(checkResult, responses.getBalanceSheet, 'getBalanceSheet'));
  });

  it('getBalanceSheet - invalid options', function () {
    return this.api.getBalanceSheet(address, { invalid: 'options' }).then(() => {
      assert(false, 'Should throw ValidationError');
    }).catch(error => {
      assert(error instanceof this.api.errors.ValidationError);
    });
  });

  it('getBalanceSheet - empty', function () {
    const options = { ledgerVersion: 123456 };
    return this.api.getBalanceSheet(address, options).then(
      _.partial(checkResult, {}, 'getBalanceSheet'));
  });

  describe('getTransaction', () => {
    it('getTransaction - payment', function () {
      return this.api.getTransaction(hashes.VALID_TRANSACTION_HASH).then(
        _.partial(checkResult, responses.getTransaction.payment,
          'getTransaction'));
    });

    it('getTransaction - payment - include raw transaction', function () {
      const options = {
        includeRawTransaction: true
      }
      return this.api.getTransaction(
        hashes.VALID_TRANSACTION_HASH, options
      ).then(
        _.partial(checkResult, responses.getTransaction.paymentIncludeRawTransaction,
          'getTransaction'));
    });

    it('getTransaction - settings', function () {
      const hash =
        '4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA1B';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.settings,
          'getTransaction'));
    });

    it('getTransaction - settings - include raw transaction', function () {
      const hash =
        '4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA1B';
      const options = {
        includeRawTransaction: true
      }
      const expected = Object.assign({}, responses.getTransaction.settings) // Avoid mutating test fixture
      expected.rawTransaction = "{\"Account\":\"rLVKsA4F9iJBbA6rX2x4wCmkj6drgtqpQe\",\"Fee\":\"10\",\"Flags\":2147483648,\"Sequence\":1,\"SetFlag\":2,\"SigningPubKey\":\"03EA3ADCA632F125EC2CC4F7F6A82DE0DCE2B65290CAC1F22242C5163F0DA9652D\",\"TransactionType\":\"AccountSet\",\"TxnSignature\":\"3045022100DE8B666B1A31EA65011B0F32130AB91A5747E32FA49B3054CEE8E8362DBAB98A022040CF0CF254677A8E5CD04C59CA2ED7F6F15F7E184641BAE169C561650967B226\",\"date\":460832270,\"hash\":\"4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA1B\",\"inLedger\":8206418,\"ledger_index\":8206418,\"meta\":{\"AffectedNodes\":[{\"ModifiedNode\":{\"FinalFields\":{\"Account\":\"rLVKsA4F9iJBbA6rX2x4wCmkj6drgtqpQe\",\"Balance\":\"29999990\",\"Flags\":786432,\"OwnerCount\":0,\"Sequence\":2},\"LedgerEntryType\":\"AccountRoot\",\"LedgerIndex\":\"3F5072C4875F32ED770DAF3610A716600ED7C7BB0348FADC7A98E011BB2CD36F\",\"PreviousFields\":{\"Balance\":\"30000000\",\"Flags\":4194304,\"Sequence\":1},\"PreviousTxnID\":\"3FB0350A3742BBCC0D8AA3C5247D1AEC01177D0A24D9C34762BAA2FEA8AD88B3\",\"PreviousTxnLgrSeq\":8206397}}],\"TransactionIndex\":5,\"TransactionResult\":\"tesSUCCESS\"},\"validated\":true}"
      return this.api.getTransaction(hash, options).then(
        _.partial(checkResult, expected,
          'getTransaction'));
    });

    it('getTransaction - order', function () {
      const hash =
        '10A6FB4A66EE80BED46AAE4815D7DC43B97E944984CCD5B93BCF3F8538CABC51';
      closeLedger(this.api.connection);
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.order,
          'getTransaction'));
    });

    it('getTransaction - sell order', function () {
      const hash =
        '458101D51051230B1D56E9ACAFAA34451BF65FA000F95DF6F0FF5B3A62D83FC2';
      closeLedger(this.api.connection);
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.orderSell,
          'getTransaction'));
    });

    it('getTransaction - order cancellation', function () {
      const hash =
        '809335DD3B0B333865096217AA2F55A4DF168E0198080B3A090D12D88880FF0E';
      closeLedger(this.api.connection);
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.orderCancellation,
          'getTransaction'));
    });

    it('getTransaction - order with expiration cancellation', function () {
      const hash =
        '097B9491CC76B64831F1FEA82EAA93BCD728106D90B65A072C933888E946C40B';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.orderWithExpirationCancellation,
          'getTransaction'));
    });

    it('getTransaction - trustline set', function () {
      const hash =
        '635A0769BD94710A1F6A76CDE65A3BC661B20B798807D1BBBDADCEA26420538D';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.trustline,
          'getTransaction'));
    });

    it('getTransaction - trustline frozen off', function () {
      const hash =
        'FE72FAD0FA7CA904FB6C633A1666EDF0B9C73B2F5A4555D37EEF2739A78A531B';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.trustlineFrozenOff,
          'getTransaction'));
    });

    it('getTransaction - trustline no quality', function () {
      const hash =
        'BAF1C678323C37CCB7735550C379287667D8288C30F83148AD3C1CB019FC9002';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.trustlineNoQuality,
          'getTransaction'));
    });

    it('getTransaction - trustline add memo', function () {
        const hash =
            '9D6AC5FD6545B2584885B85E36759EB6440CDD41B6C55859F84AFDEE2B428220';
        return this.api.getTransaction(hash).then(
            _.partial(checkResult, responses.getTransaction.trustlineAddMemo,
                'getTransaction'));
    });

    it('getTransaction - not validated', function () {
      const hash =
        '4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA10';
      return this.api.getTransaction(hash).then((response) => {
        console.log(response);
        assert(false, 'Should throw NotFoundError');
      }).catch(error => {
        assert(error instanceof this.api.errors.NotFoundError);
        assert.equal(error.message, 'Transaction not found');
      });
    });

    it('getTransaction - tracking on', function () {
      const hash =
        '8925FC8844A1E930E2CC76AD0A15E7665AFCC5425376D548BB1413F484C31B8C';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.trackingOn,
          'getTransaction'));
    });

    it('getTransaction - tracking off', function () {
      const hash =
        'C8C5E20DFB1BF533D0D81A2ED23F0A3CBD1EF2EE8A902A1D760500473CC9C582';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.trackingOff,
          'getTransaction'));
    });

    it('getTransaction - set regular key', function () {
      const hash =
        '278E6687C1C60C6873996210A6523564B63F2844FB1019576C157353B1813E60';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult, responses.getTransaction.setRegularKey,
          'getTransaction'));
    });

    it('getTransaction - not found in range', function () {
      const hash =
        '809335DD3B0B333865096217AA2F55A4DF168E0198080B3A090D12D88880FF0E';
      const options = {
        minLedgerVersion: 32570,
        maxLedgerVersion: 32571
      };
      return this.api.getTransaction(hash, options).then(() => {
        assert(false, 'Should throw NotFoundError');
      }).catch(error => {
        assert(error instanceof this.api.errors.NotFoundError);
      });
    });

    it('getTransaction - not found by hash', function () {
      const hash = hashes.NOTFOUND_TRANSACTION_HASH;
      return this.api.getTransaction(hash).then(() => {
        assert(false, 'Should throw NotFoundError');
      }).catch(error => {
        assert(error instanceof this.api.errors.NotFoundError);
      });
    });

    it('getTransaction - missing ledger history', function () {
      const hash = hashes.NOTFOUND_TRANSACTION_HASH;
      // make gaps in history
      closeLedger(this.api.connection);
      return this.api.getTransaction(hash).then(() => {
        assert(false, 'Should throw MissingLedgerHistoryError');
      }).catch(error => {
        assert(error instanceof this.api.errors.MissingLedgerHistoryError);
      });
    });

    it('getTransaction - missing ledger history with ledger range', function () {
      const hash = hashes.NOTFOUND_TRANSACTION_HASH;
      const options = {
        minLedgerVersion: 32569,
        maxLedgerVersion: 32571
      };
      return this.api.getTransaction(hash, options).then(() => {
        assert(false, 'Should throw MissingLedgerHistoryError');
      }).catch(error => {
        assert(error instanceof this.api.errors.MissingLedgerHistoryError);
      });
    });

    it('getTransaction - not found - future maxLedgerVersion', function () {
      const hash = hashes.NOTFOUND_TRANSACTION_HASH;
      const options = {
        maxLedgerVersion: 99999999999
      };
      return this.api.getTransaction(hash, options).then(() => {
        assert(false, 'Should throw PendingLedgerVersionError');
      }).catch(error => {
        assert(error instanceof this.api.errors.PendingLedgerVersionError);
        assert.strictEqual(error.message, 'maxLedgerVersion is greater than server\'s'
          + ' most recent validated ledger')
      });
    });

    it('getTransaction - transaction not validated', function () {
      const hash =
        '4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA11';
      return this.api.getTransaction(hash).then(() => {
        assert(false, 'Should throw NotFoundError');
      }).catch(error => {
        assert(error instanceof this.api.errors.NotFoundError);
        assert(error.message.indexOf('Transaction has not been validated yet') !== -1);
      });
    });

    it('getTransaction - transaction ledger not found', function () {
      const hash =
        '4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA12';
      return this.api.getTransaction(hash).then(() => {
        assert(false, 'Should throw NotFoundError');
      }).catch(error => {
        assert(error instanceof this.api.errors.NotFoundError);
        assert(error.message.indexOf('ledger not found') !== -1);
      });
    });

    it('getTransaction - ledger missing close time', function () {
      const hash =
        '0F7ED9F40742D8A513AE86029462B7A6768325583DF8EE21B7EC663019DD6A04';
      closeLedger(this.api.connection);
      return this.api.getTransaction(hash).then(() => {
        assert(false, 'Should throw UnexpectedError');
      }).catch(error => {
        assert(error instanceof this.api.errors.UnexpectedError);
      });
    });

    // Checks

    it('getTransaction - CheckCreate', function () {
      const hash =
        '605A2E2C8E48AECAF5C56085D1AEAA0348DC838CE122C9188F94EB19DA05C2FE';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.checkCreate,
          'getTransaction'));
    });

    it('getTransaction - CheckCancel', function () {
      const hash =
        'B4105D1B2D83819647E4692B7C5843D674283F669524BD50C9614182E3A12CD4';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.checkCancel,
          'getTransaction'));
    });

    it('getTransaction - CheckCash', function () {
      const hash =
        '8321208465F70BA52C28BCC4F646BAF3B012BA13B57576C0336F42D77E3E0749';
      return this.api.getTransaction(hash/*, options*/).then(
        _.partial(checkResult,
          responses.getTransaction.checkCash,
          'getTransaction'));
    });

    // Escrows

    it('getTransaction - EscrowCreation', function () {
      const hash =
        '144F272380BDB4F1BD92329A2178BABB70C20F59042C495E10BF72EBFB408EE1';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.escrowCreation,
          'getTransaction'));
    });

    it('getTransaction - EscrowCancellation', function () {
      const hash =
        'F346E542FFB7A8398C30A87B952668DAB48B7D421094F8B71776DA19775A3B22';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.escrowCancellation,
          'getTransaction'));
    });

    it('getTransaction - EscrowExecution', function () {
      const options = {
        minLedgerVersion: 10,
        maxLedgerVersion: 15
      };
      const hash =
        'CC5277137B3F25EE8B86259C83CB0EAADE818505E4E9BCBF19B1AC6FD136993B';
      return this.api.getTransaction(hash, options).then(
        _.partial(checkResult,
          responses.getTransaction.escrowExecution,
          'getTransaction'));
    });

    it('getTransaction - EscrowExecution simple', function () {
      const hash =
        'CC5277137B3F25EE8B86259C83CB0EAADE818505E4E9BCBF19B1AC6FD1369931';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.escrowExecutionSimple,
          'getTransaction'));
    });

    it('getTransaction - PaymentChannelCreate', function () {
      const hash =
        '0E9CA3AB1053FC0C1CBAA75F636FE1EC92F118C7056BBEF5D63E4C116458A16D';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.paymentChannelCreate,
          'getTransaction'));
    });

    it('getTransaction - PaymentChannelFund', function () {
      const hash =
        'CD053D8867007A6A4ACB7A432605FE476D088DCB515AFFC886CF2B4EB6D2AE8B';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.paymentChannelFund,
          'getTransaction'));
    });

    it('getTransaction - PaymentChannelClaim', function () {
      const hash =
        '81B9ECAE7195EB6E8034AEDF44D8415A7A803E14513FDBB34FA984AB37D59563';
      return this.api.getTransaction(hash).then(
        _.partial(checkResult,
          responses.getTransaction.paymentChannelClaim,
          'getTransaction'));
    });

    it('getTransaction - no Meta', function () {
      const hash =
        'AFB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA1B';
      return this.api.getTransaction(hash).then(result => {
        assert.deepEqual(result, responses.getTransaction.noMeta);
      });
    });

    it('getTransaction - Unrecognized transaction type', function () {
      const hash =
        'AFB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA11';
      closeLedger(this.api.connection);
      return this.api.getTransaction(hash).then(() => {
        assert(false, 'Unrecognized transaction type');
      }).catch(error => {
        assert.strictEqual(error.message, 'Unrecognized transaction type');
      });
    });

    it('getTransaction - amendment', function () {
      const hash =
        'A971B83ABED51D83749B73F3C1AAA627CD965AFF74BE8CD98299512D6FB0658F';
      return this.api.getTransaction(hash).then(result => {
        assert.deepEqual(result, responses.getTransaction.amendment);
      });
    });

    it('getTransaction - feeUpdate', function () {
      const hash =
        'C6A40F56127436DCD830B1B35FF939FD05B5747D30D6542572B7A835239817AF';
      return this.api.getTransaction(hash).then(result => {
        assert.deepEqual(result, responses.getTransaction.feeUpdate);
      });
    });
  });

  it('getTransactions', function () {
    const options = { types: ['payment', 'order'], initiated: true, limit: 2 };
    return this.api.getTransactions(address, options).then(
      _.partial(checkResult, responses.getTransactions.normal,
        'getTransactions'));
  });

  it('getTransactions - include raw transactions', function () {
    const options = {
      types: ['payment', 'order'],
      initiated: true,
      limit: 2,
      includeRawTransactions: true
    };
    return this.api.getTransactions(address, options).then(
      _.partial(checkResult, responses.getTransactions.includeRawTransactions,
        'getTransactions'));
  });

  it('getTransactions - earliest first', function () {
    const options = {
      types: ['payment', 'order'], initiated: true, limit: 2,
      earliestFirst: true
    };
    const expected = _.cloneDeep(responses.getTransactions.normal)
      .sort(utils.compareTransactions);
    return this.api.getTransactions(address, options).then(
      _.partial(checkResult, expected, 'getTransactions'));
  });


  it('getTransactions - earliest first with start option', function () {
    const options = {
      types: ['payment', 'order'], initiated: true, limit: 2,
      start: hashes.VALID_TRANSACTION_HASH,
      earliestFirst: true
    };
    return this.api.getTransactions(address, options).then(data => {
      assert.strictEqual(data.length, 0);
    });
  });

  it('getTransactions - gap', function () {
    const options = {
      types: ['payment', 'order'], initiated: true, limit: 2,
      maxLedgerVersion: 348858000
    };
    return this.api.getTransactions(address, options).then(() => {
      assert(false, 'Should throw MissingLedgerHistoryError');
    }).catch(error => {
      assert(error instanceof this.api.errors.MissingLedgerHistoryError);
    });
  });

  it('getTransactions - tx not found', function () {
    const options = {
      types: ['payment', 'order'], initiated: true, limit: 2,
      start: hashes.NOTFOUND_TRANSACTION_HASH,
      counterparty: address
    };
    return this.api.getTransactions(address, options).then((response) => {
      console.log(response);
      assert(false, 'Should throw NotFoundError');
    }).catch(error => {
      assert(error instanceof this.api.errors.NotFoundError);
    });
  });

  it('getTransactions - filters', function () {
    const options = {
      types: ['payment', 'order'], initiated: true, limit: 10,
      excludeFailures: true,
      counterparty: addresses.ISSUER
    };
    return this.api.getTransactions(address, options).then(data => {
      assert.strictEqual(data.length, 10);
      assert(_.every(data, t => t.type === 'payment' || t.type === 'order'));
      assert(_.every(data, t => t.outcome.result === 'tesSUCCESS'));
    });
  });

  it('getTransactions - filters for incoming', function () {
    const options = {
      types: ['payment', 'order'], initiated: false, limit: 10,
      excludeFailures: true,
      counterparty: addresses.ISSUER
    };
    return this.api.getTransactions(address, options).then(data => {
      assert.strictEqual(data.length, 10);
      assert(_.every(data, t => t.type === 'payment' || t.type === 'order'));
      assert(_.every(data, t => t.outcome.result === 'tesSUCCESS'));
    });
  });

  // this is the case where core.RippleError just falls
  // through the api to the user
  it('getTransactions - error', function () {
    const options = { types: ['payment', 'order'], initiated: true, limit: 13 };
    return this.api.getTransactions(address, options).then(() => {
      assert(false, 'Should throw RippleError');
    }).catch(error => {
      assert(error instanceof this.api.errors.RippleError);
    });
  });

  // TODO: this doesn't test much, just that it doesn't crash
  it('getTransactions with start option', function () {
    const options = {
      start: hashes.VALID_TRANSACTION_HASH,
      earliestFirst: false,
      limit: 2
    };
    return this.api.getTransactions(address, options).then(
      _.partial(checkResult, responses.getTransactions.normal,
        'getTransactions'));
  });

  it('getTransactions - start transaction with zero ledger version', function (
  ) {
    const options = {
      start: '4FB3ADF22F3C605E23FAEFAA185F3BD763C4692CAC490D9819D117CD33BFAA13',
      limit: 1
    };
    return this.api.getTransactions(address, options).then(
      _.partial(checkResult, [], 'getTransactions'));
  });

  it('getTransactions - no options', function () {
    return this.api.getTransactions(addresses.OTHER_ACCOUNT).then(
      _.partial(checkResult, responses.getTransactions.one, 'getTransactions'));
  });

  it('getTrustlines - filtered', function () {
    const options = { currency: 'USD' };
    return this.api.getTrustlines(address, options).then(
      _.partial(checkResult,
        responses.getTrustlines.filtered, 'getTrustlines'));
  });

  it('getTrustlines - more than 400 items', function () {
    const options = { limit: 401 };
    return this.api.getTrustlines(addresses.THIRD_ACCOUNT, options).then(
      _.partial(checkResult, responses.getTrustlines.moreThan400Items, 'getTrustlines'));
  });

  it('getTrustlines - no options', function () {
    return this.api.getTrustlines(address).then(
      _.partial(checkResult, responses.getTrustlines.all, 'getTrustlines'));
  });

  it('generateXAddress', function () {
    function random() {
      return _.fill(Array(16), 0);
    }
    assert.deepEqual(this.api.generateXAddress({ entropy: random() }),
      responses.generateXAddress);
  });

  it('generateXAddress invalid', function () {
    assert.throws(() => {
      function random() {
        return _.fill(Array(1), 0);
      }
      this.api.generateXAddress({ entropy: random() });
    }, this.api.errors.UnexpectedError);
  });

  it('getSettings', function () {
    return this.api.getSettings(address).then(
      _.partial(checkResult, responses.getSettings, 'getSettings'));
  });

  it('getSettings - options undefined', function () {
    return this.api.getSettings(address, undefined).then(
      _.partial(checkResult, responses.getSettings, 'getSettings'));
  });

  it('getSettings - invalid options', function () {
    return this.api.getSettings(address, { invalid: 'options' }).then(() => {
      assert(false, 'Should throw ValidationError');
    }).catch(error => {
      assert(error instanceof this.api.errors.ValidationError);
    });
  });

  it('getAccountInfo', function () {
    return this.api.getAccountInfo(address).then(
      _.partial(checkResult, responses.getAccountInfo, 'getAccountInfo'));
  });

  it('getAccountInfo - options undefined', function () {
    return this.api.getAccountInfo(address, undefined).then(
      _.partial(checkResult, responses.getAccountInfo, 'getAccountInfo'));
  });

  it('getAccountInfo - invalid options', function () {
    return this.api.getAccountInfo(address, { invalid: 'options' }).then(() => {
      assert(false, 'Should throw ValidationError');
    }).catch(error => {
      assert(error instanceof this.api.errors.ValidationError);
    });
  });

  it('getAccountObjects', function () {
    return this.api.getAccountObjects(address).then(response =>
      checkResult(responses.getAccountObjects, 'AccountObjectsResponse', response));
  });

  it('getAccountObjects - invalid options', function () {
    // Intentionally no local validation of these options
    return this.api.getAccountObjects(address, {invalid: 'options'}).then(response =>
      checkResult(responses.getAccountObjects, 'AccountObjectsResponse', response));
  });

  it('request account_objects', function () {
    return this.api.request('account_objects', {
      account: address
    }).then(response =>
      checkResult(responses.getAccountObjects, 'AccountObjectsResponse', response));
  });

  it('request account_objects - invalid options', function () {
    // Intentionally no local validation of these options
    return this.api.request('account_objects', {
      account: address,
      invalid: 'options'
    }).then(response =>
      checkResult(responses.getAccountObjects, 'AccountObjectsResponse', response));
  });

  it('getOrders', function () {
    return this.api.getOrders(address).then(
      _.partial(checkResult, JSON.parse(JSON.stringify(responses.getOrders).replace(/r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59/g, 'X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ')), 'getOrders'));
  });

  it('getOrders - limit', function () {
    return this.api.getOrders(address, { limit: 20 }).then(
      _.partial(checkResult, JSON.parse(JSON.stringify(responses.getOrders).replace(/r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59/g, 'X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ')), 'getOrders'));
  });

  it('getOrders - invalid options', function () {
    return this.api.getOrders(address, { invalid: 'options' }).then(() => {
      assert(false, 'Should throw ValidationError');
    }).catch(error => {
      assert(error instanceof this.api.errors.ValidationError);
    });
  });

  describe('formatBidsAndAsks', function () {

    it('normal', function () {
      const orderbookInfo = {
        "base": {
          "currency": "USD",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        },
        "counter": {
          "currency": "BTC",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        }
      };

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        assert.deepEqual(orderbook, responses.getOrderbook.normal);
      });
    });

    it('with XRP', function () {
      const orderbookInfo = {
        "base": {
          "currency": "USD",
          "counterparty": "rp8rJYTpodf8qbSCHVTNacf8nSW8mRakFw"
        },
        "counter": {
          "currency": "XRP"
        }
      };

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        assert.deepEqual(orderbook, responses.getOrderbook.withXRP);
      });
    });

    function checkSortingOfOrders(orders) {
      let previousRate = '0';
      for (var i = 0; i < orders.length; i++) {
        const order = orders[i];
        let rate;

        // We calculate the quality of output/input here as a test.
        // This won't hold in general because when output and input amounts get tiny,
        // the quality can differ significantly. However, the offer stays in the
        // order book where it was originally placed. It would be more consistent
        // to check the quality from the offer book, but for the test data set,
        // this calculation holds.

        if (order.specification.direction === 'buy') {
          rate = (new BigNumber(order.specification.quantity.value))
          .dividedBy(order.specification.totalPrice.value)
          .toString();
        } else {
          rate = (new BigNumber(order.specification.totalPrice.value))
          .dividedBy(order.specification.quantity.value)
          .toString();
        }
        assert((new BigNumber(rate)).greaterThanOrEqualTo(previousRate),
          'Rates must be sorted from least to greatest: ' +
          rate + ' should be >= ' + previousRate);
        previousRate = rate;
      }
      return true;
    }

    it('sample XRP/JPY book has orders sorted correctly', function () {
      const orderbookInfo = {
        "base": { // the first currency in pair
          "currency": 'XRP'
        },
        "counter": {
          "currency": 'JPY',
          "counterparty": "rB3gZey7VWHYRqJHLoHDEJXJ2pEPNieKiS"
        }
      };

      const myAddress = 'rE9qNjzJXpiUbVomdv7R4xhrXVeH2oVmGR';

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 400, // must match `test/fixtures/rippled/requests/1-taker_gets-XRP-taker_pays-JPY.json`
            taker: myAddress
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 400, // must match `test/fixtures/rippled/requests/2-taker_gets-JPY-taker_pays-XRP.json`
            taker: myAddress
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        assert.deepStrictEqual([], orderbook.bids);
        return checkSortingOfOrders(orderbook.asks);
      });
    });

    it('sample USD/XRP book has orders sorted correctly', function () {
      const orderbookInfo = { counter: { currency: 'XRP' },
      base: { currency: 'USD',
       counterparty: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' } };

      const myAddress = 'rE9qNjzJXpiUbVomdv7R4xhrXVeH2oVmGR';

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 400, // must match `test/fixtures/rippled/requests/1-taker_gets-XRP-taker_pays-JPY.json`
            taker: myAddress
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 400, // must match `test/fixtures/rippled/requests/2-taker_gets-JPY-taker_pays-XRP.json`
            taker: myAddress
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        return checkSortingOfOrders(orderbook.bids) && checkSortingOfOrders(orderbook.asks);
      });
    });

    it('sorted so that best deals come first', function () {
      const orderbookInfo = {
        "base": {
          "currency": "USD",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        },
        "counter": {
          "currency": "BTC",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        }
      };

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        
        const bidRates = orderbook.bids.map(bid => bid.properties.makerExchangeRate);
        const askRates = orderbook.asks.map(ask => ask.properties.makerExchangeRate);
        // makerExchangeRate = quality = takerPays.value/takerGets.value
        // so the best deal for the taker is the lowest makerExchangeRate
        // bids and asks should be sorted so that the best deals come first
        assert.deepEqual(_.sortBy(bidRates, x => Number(x)), bidRates);
        assert.deepEqual(_.sortBy(askRates, x => Number(x)), askRates);
      });
    });

    it('currency & counterparty are correct', function () {
      const orderbookInfo = {
        "base": {
          "currency": "USD",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        },
        "counter": {
          "currency": "BTC",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        }
      };

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        
        const orders = _.flatten([orderbook.bids, orderbook.asks]);
        _.forEach(orders, order => {
          const quantity = order.specification.quantity;
          const totalPrice = order.specification.totalPrice;
          const { base, counter } = requests.getOrderbook.normal;
          assert.strictEqual(quantity.currency, base.currency);
          assert.strictEqual(quantity.counterparty, base.counterparty);
          assert.strictEqual(totalPrice.currency, counter.currency);
          assert.strictEqual(totalPrice.counterparty, counter.counterparty);
        });
      });
    });

    it('direction is correct for bids and asks', function () {
      const orderbookInfo = {
        "base": {
          "currency": "USD",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        },
        "counter": {
          "currency": "BTC",
          "counterparty": "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B"
        }
      };

      return Promise.all(
        [
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          }),
          this.api.request('book_offers', {
            taker_gets: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.counter),
            taker_pays: RippleAPI.renameCounterpartyToIssuer(orderbookInfo.base),
            ledger_index: 'validated',
            limit: 20,
            taker: address
          })
        ]
      ).then((directOfferResults, reverseOfferResults) => {
        const directOffers = (directOfferResults ? directOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const reverseOffers = (reverseOfferResults ? reverseOfferResults : []).reduce((acc, res) => acc.concat(res.offers), [])
        const orderbook = RippleAPI.formatBidsAndAsks(orderbookInfo, [...directOffers, ...reverseOffers]);
        
        assert(
          _.every(orderbook.bids, bid => bid.specification.direction === 'buy'));
        assert(
          _.every(orderbook.asks, ask => ask.specification.direction === 'sell'));
      });
    });
  });

  describe('getOrderbook', function () {

    it('normal', function () {
      return this.api.getOrderbook(address,
        requests.getOrderbook.normal, { limit: 20 }).then(
          _.partial(checkResult,
            responses.getOrderbook.normal, 'getOrderbook'));
    });

    it('invalid options', function () {
      return this.api.getOrderbook(
        address, requests.getOrderbook.normal, { invalid: 'options' }
      ).then(() => {
        assert(false, 'Should throw ValidationError');
      }).catch(error => {
        assert(error instanceof this.api.errors.ValidationError);
      });
    });

    it('with XRP', function () {
      return this.api.getOrderbook(address, requests.getOrderbook.withXRP).then(
        _.partial(checkResult, responses.getOrderbook.withXRP, 'getOrderbook'));
    });

    function checkSortingOfOrders(orders) {
      let previousRate = '0';
      for (var i = 0; i < orders.length; i++) {
        const order = orders[i];
        let rate;

        // We calculate the quality of output/input here as a test.
        // This won't hold in general because when output and input amounts get tiny,
        // the quality can differ significantly. However, the offer stays in the
        // order book where it was originally placed. It would be more consistent
        // to check the quality from the offer book, but for the test data set,
        // this calculation holds.

        if (order.specification.direction === 'buy') {
          rate = (new BigNumber(order.specification.quantity.value))
          .dividedBy(order.specification.totalPrice.value)
          .toString();
        } else {
          rate = (new BigNumber(order.specification.totalPrice.value))
          .dividedBy(order.specification.quantity.value)
          .toString();
        }
        assert((new BigNumber(rate)).greaterThanOrEqualTo(previousRate),
          'Rates must be sorted from least to greatest: ' +
          rate + ' should be >= ' + previousRate);
        previousRate = rate;
      }
      return true;
    }

    it('sample XRP/JPY book has orders sorted correctly', function () {
      const orderbookInfo = {
        "base": { // the first currency in pair
          "currency": 'XRP'
        },
        "counter": {
          "currency": 'JPY',
          "counterparty": "rB3gZey7VWHYRqJHLoHDEJXJ2pEPNieKiS"
        }
      };

      const myAddress = 'rE9qNjzJXpiUbVomdv7R4xhrXVeH2oVmGR';

      return this.api.getOrderbook(myAddress, orderbookInfo).then(orderbook => {
        assert.deepStrictEqual([], orderbook.bids);
        return checkSortingOfOrders(orderbook.asks);
      });
    });

    it('sample USD/XRP book has orders sorted correctly', function () {
      const orderbookInfo = { counter: { currency: 'XRP' },
      base: { currency: 'USD',
       counterparty: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' } };

      const myAddress = 'rE9qNjzJXpiUbVomdv7R4xhrXVeH2oVmGR';

      return this.api.getOrderbook(myAddress, orderbookInfo).then(orderbook => {
        return checkSortingOfOrders(orderbook.bids) && checkSortingOfOrders(orderbook.asks);
      });
    });

    // WARNING: This test fails to catch the sorting bug, issue #766
    it('sorted so that best deals come first [bad test]', function () {
      return this.api.getOrderbook(address, requests.getOrderbook.normal)
        .then(data => {
          const bidRates = data.bids.map(bid => bid.properties.makerExchangeRate);
          const askRates = data.asks.map(ask => ask.properties.makerExchangeRate);
          // makerExchangeRate = quality = takerPays.value/takerGets.value
          // so the best deal for the taker is the lowest makerExchangeRate
          // bids and asks should be sorted so that the best deals come first
          assert.deepEqual(_.sortBy(bidRates, x => Number(x)), bidRates);
          assert.deepEqual(_.sortBy(askRates, x => Number(x)), askRates);
        });
    });

    it('currency & counterparty are correct', function () {
      return this.api.getOrderbook(address, requests.getOrderbook.normal)
        .then(data => {
          const orders = _.flatten([data.bids, data.asks]);
          _.forEach(orders, order => {
            const quantity = order.specification.quantity;
            const totalPrice = order.specification.totalPrice;
            const { base, counter } = requests.getOrderbook.normal;
            assert.strictEqual(quantity.currency, base.currency);
            assert.strictEqual(quantity.counterparty, base.counterparty);
            assert.strictEqual(totalPrice.currency, counter.currency);
            assert.strictEqual(totalPrice.counterparty, counter.counterparty);
          });
        });
    });

    it('direction is correct for bids and asks', function () {
      return this.api.getOrderbook(address, requests.getOrderbook.normal)
        .then(data => {
          assert(
            _.every(data.bids, bid => bid.specification.direction === 'buy'));
          assert(
            _.every(data.asks, ask => ask.specification.direction === 'sell'));
        });
    });

  });

  it('getPaymentChannel', function () {
    const channelId =
      'E30E709CF009A1F26E0E5C48F7AA1BFB79393764F15FB108BDC6E06D3CBD8415';
    return this.api.getPaymentChannel(channelId).then(
      _.partial(checkResult, responses.getPaymentChannel.normal,
        'getPaymentChannel'));
  });

  it('getPaymentChannel - full', function () {
    const channelId =
      'D77CD4713AA08195E6B6D0E5BC023DA11B052EBFF0B5B22EDA8AE85345BCF661';
    return this.api.getPaymentChannel(channelId).then(
      _.partial(checkResult, responses.getPaymentChannel.full,
        'getPaymentChannel'));
  });

  it('getPaymentChannel - not found', function () {
    const channelId =
      'DFA557EA3497585BFE83F0F97CC8E4530BBB99967736BB95225C7F0C13ACE708';
    return this.api.getPaymentChannel(channelId).then(() => {
      assert(false, 'Should throw entryNotFound');
    }).catch(error => {
      assert(error instanceof this.api.errors.RippledError);
      assert.equal(error.message, 'entryNotFound');
      assert.equal(error.data.error, 'entryNotFound');
    });
  });

  it('getPaymentChannel - wrong type', function () {
    const channelId =
      '8EF9CCB9D85458C8D020B3452848BBB42EAFDDDB69A93DD9D1223741A4CA562B';
    return this.api.getPaymentChannel(channelId).then(() => {
      assert(false, 'Should throw NotFoundError');
    }).catch(error => {
      assert(_.includes(error.message,
        'Payment channel ledger entry not found'));
      assert(error instanceof this.api.errors.NotFoundError);
    });
  });

  it('getServerInfo', function () {
    return this.api.getServerInfo().then(
      _.partial(checkResult, responses.getServerInfo, 'getServerInfo'));
  });

  it('getServerInfo - error', function () {
    this.api.connection._send(JSON.stringify({
      command: 'config',
      data: { returnErrorOnServerInfo: true }
    }));

    return this.api.getServerInfo().then(() => {
      assert(false, 'Should throw NetworkError');
    }).catch(error => {
      assert(error instanceof this.api.errors.RippledError);
      assert.equal(error.message, 'You are placing too much load on the server.');
      assert.equal(error.data.error, 'slowDown');
    });
  });

  it('getServerInfo - no validated ledger', function () {
    this.api.connection._send(JSON.stringify({
      command: 'config',
      data: { serverInfoWithoutValidated: true }
    }));

    return this.api.getServerInfo().then(info => {
      assert.strictEqual(info.networkLedger, 'waiting');
    }).catch(error => {
      assert(false, 'Should not throw Error, got ' + String(error));
    });
  });

  it('getFee', function () {
    return this.api.getFee().then(fee => {
      assert.strictEqual(fee, '0.000012');
    });
  });

  it('getFee default', function () {
    this.api._feeCushion = undefined;
    return this.api.getFee().then(fee => {
      assert.strictEqual(fee, '0.000012');
    });
  });

  it('getFee - high load_factor', function () {
    this.api.connection._send(JSON.stringify({
      command: 'config',
      data: { highLoadFactor: true }
    }));

    return this.api.getFee().then(fee => {
      assert.strictEqual(fee, '2');
    });
  });

  it('getFee - high load_factor with custom maxFeeXRP', function () {
    // Ensure that overriding with high maxFeeXRP of '51540' causes no errors.
    // (fee will actually be 51539.607552)
    this.api._maxFeeXRP = '51540'
    this.api.connection._send(JSON.stringify({
      command: 'config',
      data: { highLoadFactor: true }
    }));

    return this.api.getFee().then(fee => {
      assert.strictEqual(fee, '51539.607552');
    });
  });

  it('fee - default maxFee of 2 XRP', function () {
    this.api._feeCushion = 1000000;

    const expectedResponse = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"2000000\",\"Sequence\":23}",
      "instructions": {
        "fee": "2",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }    

    return this.api.preparePayment(
      address, requests.preparePayment.normal, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult, expectedResponse, 'prepare'));
  });

  it('fee - capped to maxFeeXRP when maxFee exceeds maxFeeXRP', function () {
    this.api._feeCushion = 1000000
    this.api._maxFeeXRP = '3'
    const localInstructions = _.defaults({
      maxFee: '4'
    }, instructionsWithMaxLedgerVersionOffset);

    const expectedResponse = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"3000000\",\"Sequence\":23}",
      "instructions": {
        "fee": "3",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }    

    return this.api.preparePayment(
      address, requests.preparePayment.normal, localInstructions).then(
        _.partial(checkResult, expectedResponse, 'prepare'));
  });

  it('fee - capped to maxFee', function () {
    this.api._feeCushion = 1000000
    this.api._maxFeeXRP = '5'
    const localInstructions = _.defaults({
      maxFee: '4'
    }, instructionsWithMaxLedgerVersionOffset);

    const expectedResponse = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"4000000\",\"Sequence\":23}",
      "instructions": {
        "fee": "4",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }    

    return this.api.preparePayment(
      address, requests.preparePayment.normal, localInstructions).then(
        _.partial(checkResult, expectedResponse, 'prepare'));
  });

  it('fee - calculated fee does not use more than 6 decimal places', function () {
    this.api.connection._send(JSON.stringify({
      command: 'config',
      data: { loadFactor: 5407.96875 }
    }));

    const expectedResponse = {
      "txJSON": "{\"Flags\":2147483648,\"TransactionType\":\"Payment\",\"Account\":\"r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59\",\"Destination\":\"rpZc4mVfWUif9CRoHRKKcmhu1nx2xktxBo\",\"Amount\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"SendMax\":{\"value\":\"0.01\",\"currency\":\"USD\",\"issuer\":\"rMH4UxPrbuMa1spCBR98hLLyNJp4d8p4tM\"},\"LastLedgerSequence\":8820051,\"Fee\":\"64896\",\"Sequence\":23}",
      "instructions": {
        "fee": "0.064896",
        "sequence": 23,
        "maxLedgerVersion": 8820051
      }
    }    

    return this.api.preparePayment(
      address, requests.preparePayment.normal, instructionsWithMaxLedgerVersionOffset).then(
        _.partial(checkResult, expectedResponse, 'prepare'));
  });

  // TODO: Test using getPaths with X-addresses

  // it('getPaths', function () {
  //   return this.api.getPaths(requests.getPaths.normal).then(
  //     _.partial(checkResult, responses.getPaths.XrpToUsd, 'getPaths'));
  // });

  // it('getPaths - result path has source_amount in drops', function () {
  //   return this.api.getPaths({
  //     source: {
  //       address: 'rB2NTuTTS3eNCsWxZYzJ4wqRqxNLZqA9Vx',
  //       amount: {
  //         value: this.api.dropsToXrp(1000000),
  //         currency: 'XRP'
  //       }
  //     },
  //     destination: {
  //       address: 'rhpJkBfZGQyT1xeDbwtKEuSrSXw3QZSAy5',
  //       amount: {
  //         counterparty: 'rGpGaj4sxEZGenW1prqER25EUi7x4fqK9u',
  //         currency: 'EUR'
  //       }
  //     }
  //   }).then(
  //     _.partial(checkResult, [
  //       {
  //         "source": {
  //           "address": "rB2NTuTTS3eNCsWxZYzJ4wqRqxNLZqA9Vx",
  //           "amount": {
  //             "currency": "XRP",
  //             "value": "1"
  //           }
  //         },
  //         "destination": {
  //           "address": "rhpJkBfZGQyT1xeDbwtKEuSrSXw3QZSAy5",
  //           "minAmount": {
  //             "currency": "EUR",
  //             "value": "1",
  //             "counterparty": "rGpGaj4sxEZGenW1prqER25EUi7x4fqK9u"
  //           }
  //         },
  //         "paths": "[[{\"currency\":\"USD\",\"issuer\":\"rGpGaj4sxEZGenW1prqER25EUi7x4fqK9u\"},{\"currency\":\"EUR\",\"issuer\":\"rGpGaj4sxEZGenW1prqER25EUi7x4fqK9u\"}]]"
  //       }
  //     ], 'getPaths'));
  // });
});

// TODO: Add test for using X-addresses 'offline'

// describe('RippleAPI - offline', function () {
//   it('prepareSettings and sign', function () {
//     const api = new RippleAPI();
//     const secret = 'shsWGZcmZz6YsWWmcnpfr6fLTdtFV';
//     const settings = requests.prepareSettings.domain;
//     const instructions = {
//       sequence: 23,
//       maxLedgerVersion: 8820051,
//       fee: '0.000012'
//     };
//     return api.prepareSettings(address, settings, instructions).then(data => {
//       checkResult(responses.prepareSettings.flags, 'prepare', data);
//       assert.deepEqual(api.sign(data.txJSON, secret),
//         responses.prepareSettings.signed);
//     });
//   });
// });
