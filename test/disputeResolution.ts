import { time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerArbitrator,
  KnowledgeLayerEscrow,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import {
  ETH_ADDRESS,
  META_EVIDENCE_CID,
  FEE_DIVIDER,
  MintStatus,
  ARBITRATION_FEE_TIMEOUT,
  TransactionStatus,
  DisputeStatus,
  EVIDENCE_CID,
  PaymentType,
} from '../utils/constants';
import { deploy } from '../utils/deploy';

const aliceId = 1;
const bobId = 2;
const daveId = 3;
const originPlatformId = 1;
const buyPlatformId = 2;
const originFee = 200;
const buyFee = 300;
const courseId = 1;
const coursePrice = ethers.utils.parseEther('100');
const courseDisputePeriod = 60 * 60 * 24 * 7; // 7 days
const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
const transactionId = 1;
const transactionAmount = coursePrice;
const arbitrationCost = ethers.utils.parseEther('0.01');
const disputeId = 0;

/**
 * Deploys contract and sets up the context for dispute resolution.
 * @param arbitrationFeeTimeout the timeout for the arbitration fee
 * @param tokenAddress the payment token used for this case
 * @returns the deployed contracts
 */
async function deployAndSetup(
  arbitrationFeeTimeout: number,
  tokenAddress: string,
): Promise<
  [KnowledgeLayerPlatformID, KnowledgeLayerCourse, KnowledgeLayerEscrow, KnowledgeLayerArbitrator]
> {
  const [deployer, alice, bob, carol, dave] = await ethers.getSigners();
  const [
    knowledgeLayerID,
    knowledgeLayerPlatformID,
    knowledgeLayerCourse,
    knowledgeLayerEscrow,
    ,
    knowledgeLayerArbitrator,
  ] = await deploy();

  // Add carol to whitelist and mint platform ID
  await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
  await knowledgeLayerPlatformID.connect(deployer).whitelistUser(dave.address);
  await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
  await knowledgeLayerPlatformID.connect(dave).mint('dave-platform');

  // Update platform fees
  await knowledgeLayerPlatformID.connect(carol).updateOriginFee(originPlatformId, originFee);
  await knowledgeLayerPlatformID.connect(dave).updateBuyFee(buyPlatformId, buyFee);

  // Mint KnowledgeLayer IDs
  await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
  await knowledgeLayerID.connect(alice).mint(originPlatformId, 'alice');
  await knowledgeLayerID.connect(bob).mint(originPlatformId, 'bob__');
  await knowledgeLayerID.connect(dave).mint(originPlatformId, 'dave_');

  // Add KnowledgeLayerArbitrator to platform available arbitrators
  await knowledgeLayerPlatformID
    .connect(deployer)
    .addArbitrator(knowledgeLayerArbitrator.address, true);

  // Update platform arbitrator, and fee timeout
  await knowledgeLayerPlatformID
    .connect(carol)
    .updateArbitrator(originPlatformId, knowledgeLayerArbitrator.address, []);
  await knowledgeLayerPlatformID
    .connect(carol)
    .updateArbitrationFeeTimeout(originPlatformId, arbitrationFeeTimeout);

  // Update arbitration cost
  await knowledgeLayerArbitrator
    .connect(carol)
    .setArbitrationPrice(originPlatformId, arbitrationCost);

  // Alice creates a course
  await knowledgeLayerCourse
    .connect(alice)
    .createCourse(
      aliceId,
      originPlatformId,
      coursePrice,
      tokenAddress,
      courseDisputePeriod,
      courseDataUri,
    );

  return [
    knowledgeLayerPlatformID,
    knowledgeLayerCourse,
    knowledgeLayerEscrow,
    knowledgeLayerArbitrator,
  ];
}

async function createTransaction(
  knowledgeLayerEscrow: KnowledgeLayerEscrow,
  signer: SignerWithAddress,
  profileId: number,
): Promise<[ContractTransaction, BigNumber, number, number, number]> {
  const protocolFee = await knowledgeLayerEscrow.protocolFee();
  const totalTransactionAmount = transactionAmount.add(
    transactionAmount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER),
  );

  const tx = await knowledgeLayerEscrow
    .connect(signer)
    .createTransaction(profileId, courseId, buyPlatformId, META_EVIDENCE_CID, {
      value: totalTransactionAmount,
    });

  return [tx, totalTransactionAmount, protocolFee, originFee, buyFee];
}

describe.only('Dispute Resolution, standard flow', () => {
  let alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    knowledgeLayerArbitrator: KnowledgeLayerArbitrator,
    protocolFee: number,
    originFee: number,
    buyFee: number;

  const rulingId = 1;
  const newArbitrationCost = ethers.utils.parseEther('0.008');
  const arbitrationCostDifference = arbitrationCost.sub(newArbitrationCost);

  before(async () => {
    [, alice, bob, carol, dave] = await ethers.getSigners();
    [, , knowledgeLayerEscrow, knowledgeLayerArbitrator] = await deployAndSetup(
      ARBITRATION_FEE_TIMEOUT,
      ETH_ADDRESS,
    );
  });

  describe('Submit meta evidence', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Create transaction, Bob buys Alice's course
      [tx, , protocolFee, originFee, buyFee] = await createTransaction(
        knowledgeLayerEscrow,
        bob,
        bobId,
      );
    });

    it('Meta evidence is submitted', async () => {
      await expect(tx)
        .to.emit(knowledgeLayerEscrow, 'MetaEvidence')
        .withArgs(transactionId, META_EVIDENCE_CID);
    });
  });

  describe('Attempt to open dispute by receiver', async () => {
    it("Receiver can't open a dispute", async () => {
      const tx = knowledgeLayerEscrow.connect(alice).payArbitrationFeeByReceiver(transactionId, {
        value: arbitrationCost,
      });
      await expect(tx).to.be.revertedWith('Receiver does not have to pay');
    });
  });

  describe('Payment of arbitration fee by sender', async () => {
    it('Fails if the transaction does not have an arbitrator set', async () => {
      const tx = knowledgeLayerEscrow.connect(bob).payArbitrationFeeBySender(0, {
        value: arbitrationCost,
      });
      await expect(tx).to.be.revertedWith('Arbitrator not set');
    });

    it('Fails if is not called by the sender of the transaction', async () => {
      const tx = knowledgeLayerEscrow.connect(dave).payArbitrationFeeBySender(transactionId, {
        value: arbitrationCost,
      });
      await expect(tx).to.be.revertedWith('The caller must be the sender');
    });

    it('Fails if the amount of ETH sent is less than the arbitration cost', async () => {
      const tx = knowledgeLayerEscrow.connect(bob).payArbitrationFeeBySender(transactionId, {
        value: arbitrationCost.sub(1),
      });
      await expect(tx).to.be.revertedWith('The sender fee must be equal to the arbitration cost');
    });

    describe('Successful payment of arbitration fee', async () => {
      let tx: ContractTransaction;

      before(async () => {
        // Bob pays arbitration fee to open a dispute
        tx = await knowledgeLayerEscrow.connect(bob).payArbitrationFeeBySender(transactionId, {
          value: arbitrationCost,
        });
      });

      it('Arbitration fee is sent from sender to escrow', async () => {
        await expect(tx).to.changeEtherBalances(
          [bob.address, knowledgeLayerEscrow.address],
          [arbitrationCost.mul(-1), arbitrationCost],
        );
      });

      it('The transaction data is updated correctly', async () => {
        const transaction = await knowledgeLayerEscrow.connect(bob).getTransaction(transactionId);

        // Fee paid by sender is updated correctly
        expect(transaction.senderFee).to.be.eq(arbitrationCost);

        // Timestamp of last interaction is udpated correctly
        const lastBlockTimestamp = await time.latest();
        expect(transaction.lastInteraction).to.be.eq(lastBlockTimestamp);

        // Transaction status is updated correctly
        expect(transaction.status).to.be.eq(TransactionStatus.WaitingReceiver);
      });
    });
  });

  describe('Attempt to end dispute before arbitration fee timeout has passed', async () => {
    it('Fails if arbitration fee timeout has not passed', async () => {
      const tx = knowledgeLayerEscrow.connect(bob).arbitrationFeeTimeout(transactionId);
      await expect(tx).to.be.revertedWith('Timeout time has not passed yet');
    });
  });

  describe('Payment of arbitration fee by receiver and creation of dispute', async () => {
    before(async () => {
      // Carol (platform owner) decreases arbitration fee on arbitrator
      await knowledgeLayerArbitrator
        .connect(carol)
        .setArbitrationPrice(originPlatformId, newArbitrationCost);
    });

    it('Fails if the transaction does not have an arbitrator set', async () => {
      const tx = knowledgeLayerEscrow.connect(alice).payArbitrationFeeByReceiver(0, {
        value: newArbitrationCost,
      });
      await expect(tx).to.be.revertedWith('Arbitrator not set');
    });

    it('Fails if is not called by the receiver of the transaction', async () => {
      const tx = knowledgeLayerEscrow.connect(dave).payArbitrationFeeByReceiver(transactionId, {
        value: newArbitrationCost,
      });
      await expect(tx).to.be.revertedWith('The caller must be the receiver');
    });

    it('Fails if the amount of ETH sent is less than the arbitration cost', async () => {
      const tx = knowledgeLayerEscrow.connect(alice).payArbitrationFeeByReceiver(transactionId, {
        value: newArbitrationCost.sub(1),
      });
      await expect(tx).to.be.revertedWith('The receiver fee must be equal to the arbitration cost');
    });

    describe('Successful payment of arbitration fee', async () => {
      let tx: ContractTransaction;

      before(async () => {
        tx = await knowledgeLayerEscrow.connect(alice).payArbitrationFeeByReceiver(transactionId, {
          value: newArbitrationCost,
        });
      });

      it('The arbitration fee is sent to the arbitrator', async () => {
        await expect(tx).to.changeEtherBalances(
          [alice.address, knowledgeLayerEscrow.address, knowledgeLayerArbitrator.address],
          [newArbitrationCost.mul(-1), arbitrationCostDifference.mul(-1), newArbitrationCost],
        );
      });

      it('Sender is reimbursed for overpaying arbitration fee', async () => {
        await expect(tx).to.changeEtherBalances([bob.address], [arbitrationCostDifference]);
      });

      it('The transaction data is updated correctly', async () => {
        const transaction = await knowledgeLayerEscrow.connect(alice).getTransaction(transactionId);

        // Fee paid by sender and receiver is updated correctly
        expect(transaction.senderFee).to.be.eq(newArbitrationCost);
        expect(transaction.receiverFee).to.be.eq(newArbitrationCost);

        // Timestamp of last interaction is udpated correctly
        const lastBlockTimestamp = await time.latest();
        expect(transaction.lastInteraction).to.be.eq(lastBlockTimestamp);

        // Transaction status is updated correctly
        expect(transaction.status).to.be.eq(TransactionStatus.DisputeCreated);
      });

      it('A dispute is created with the correct data', async () => {
        const receipt = await tx.wait();
        const disputeId = receipt.events?.find((e) => e.event === 'Dispute')?.args?._disputeID;

        const dispute = await knowledgeLayerArbitrator.disputes(disputeId);
        expect(dispute.arbitrated).to.be.eq(knowledgeLayerEscrow.address);
        expect(dispute.fee).to.be.eq(newArbitrationCost);
        expect(dispute.platformId).to.be.eq(originPlatformId);

        const status = await knowledgeLayerArbitrator.disputeStatus(disputeId);
        const ruling = await knowledgeLayerArbitrator.currentRuling(disputeId);
        expect(status).to.be.eq(DisputeStatus.Waiting);
        expect(ruling).to.be.eq(0);
      });
    });
  });

  describe('Attempt to release after a dispute', async () => {
    it('Release fails since ther must be no dispute to release', async () => {
      const tx = knowledgeLayerEscrow.connect(alice).release(aliceId, transactionId);
      await expect(tx).to.be.revertedWith('Transaction is in dispute');
    });
  });

  describe('Submission of Evidence', async () => {
    it('Fails if the transaction does not have an arbitrator set', async () => {
      const tx = knowledgeLayerEscrow.connect(bob).submitEvidence(bobId, 0, EVIDENCE_CID);
      await expect(tx).to.be.revertedWith('Arbitrator not set');
    });

    it('Fails if the cid is invalid', async () => {
      const tx = knowledgeLayerEscrow.connect(bob).submitEvidence(bobId, transactionId, '');
      await expect(tx).to.be.revertedWith('Invalid cid');
    });

    it('Fails if evidence is not submitted by either sender or receiver of the transaction', async () => {
      const tx = knowledgeLayerEscrow
        .connect(dave)
        .submitEvidence(daveId, transactionId, EVIDENCE_CID);
      await expect(tx).to.be.revertedWith(
        'The caller must be the sender or the receiver or their delegates',
      );
    });

    it('Sender can submit evidence', async () => {
      const tx = await knowledgeLayerEscrow
        .connect(bob)
        .submitEvidence(bobId, transactionId, EVIDENCE_CID);
      await expect(tx)
        .to.emit(knowledgeLayerEscrow, 'Evidence')
        .withArgs(knowledgeLayerArbitrator.address, transactionId, bob.address, EVIDENCE_CID);
    });

    it('Receiver can submit evidence', async () => {
      const tx = await knowledgeLayerEscrow
        .connect(alice)
        .submitEvidence(aliceId, transactionId, EVIDENCE_CID);
      await expect(tx)
        .to.emit(knowledgeLayerEscrow, 'Evidence')
        .withArgs(knowledgeLayerArbitrator.address, transactionId, alice.address, EVIDENCE_CID);
    });
  });

  describe('Submission of a ruling', async function () {
    it('Fails if ruling is not given by the arbitrator contract', async function () {
      const tx = knowledgeLayerEscrow.connect(dave).rule(disputeId, rulingId);
      await expect(tx).to.be.revertedWith('The caller must be the arbitrator');
    });

    describe('Successful submission of a ruling', async function () {
      let tx: ContractTransaction;

      before(async function () {
        // Rule in favor of the sender (Bob)
        tx = await knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, rulingId);
      });

      it('The winner of the dispute (sender) receives escrow funds and gets arbitration fee reimbursed', async function () {
        // Calculate total sent amount, including fees and arbitration cost reimbursement
        const totalAmountSent = transactionAmount
          .add(transactionAmount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER))
          .add(newArbitrationCost);

        await expect(tx).to.changeEtherBalances(
          [bob.address, knowledgeLayerEscrow.address],
          [totalAmountSent, totalAmountSent.mul(-1)],
        );
      });

      it('The owner of the platform receives the arbitration fee', async function () {
        await expect(tx).to.changeEtherBalances(
          [carol.address, knowledgeLayerArbitrator.address],
          [newArbitrationCost, newArbitrationCost.mul(-1)],
        );
      });

      it('The transaction data is updated correctly', async function () {
        const transaction = await knowledgeLayerEscrow.connect(bob).getTransaction(transactionId);
        expect(transaction.status).to.be.eq(TransactionStatus.Resolved);
        expect(transaction.senderFee).to.be.eq(0);
        expect(transaction.receiverFee).to.be.eq(newArbitrationCost);
      });

      it('Dispute data is updated correctly', async function () {
        const status = await knowledgeLayerArbitrator.disputeStatus(disputeId);
        const ruling = await knowledgeLayerArbitrator.currentRuling(disputeId);
        expect(status).to.be.eq(DisputeStatus.Solved);
        expect(ruling).to.be.eq(rulingId);
      });

      it('Emits the Payment event', async function () {
        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'Payment')
          .withArgs(transactionId, PaymentType.Reimburse, transactionAmount);
      });
    });
  });

  describe('Appealing a ruling', async function () {
    it('Fails if the transaction does not have an arbitrator set', async function () {
      const tx = knowledgeLayerEscrow.connect(bob).appeal(0);
      await expect(tx).to.be.revertedWith('Arbitrator not set');
    });

    it('Fails because cost is too high', async function () {
      const tx = knowledgeLayerEscrow.connect(bob).appeal(transactionId, {
        value: ethers.utils.parseEther('100'),
      });
      await expect(tx).to.be.revertedWith('Not enough ETH to cover appeal costs.');
    });
  });

  describe('Attempt to do dispute actions on a resolved dispute', async function () {
    it('Fails to pay arbitration fee by sender on resolved dispute', async function () {
      const tx = knowledgeLayerEscrow.connect(bob).payArbitrationFeeBySender(transactionId, {
        value: newArbitrationCost,
      });
      await expect(tx).to.be.revertedWith('Dispute already created');
    });

    it('Fails to submit evidence on resolved dispute', async function () {
      const tx = knowledgeLayerEscrow
        .connect(bob)
        .submitEvidence(bobId, transactionId, EVIDENCE_CID);
      await expect(tx).to.be.revertedWith('Must not send evidence if the dispute is resolved');
    });

    it('Submission of ruling fails if the dispute is already solved', async function () {
      const tx = knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, rulingId);
      await expect(tx).to.be.revertedWith('The dispute must not be solved already.');
    });
  });
});

describe.only('Dispute Resolution, with receiver failing to pay arbitration fee on time', function () {
  let bob: SignerWithAddress, knowledgeLayerEscrow: KnowledgeLayerEscrow, protocolFee: number;

  before(async () => {
    [, , bob] = await ethers.getSigners();
    [, , knowledgeLayerEscrow] = await deployAndSetup(ARBITRATION_FEE_TIMEOUT, ETH_ADDRESS);

    // Create transaction, Bob buys Alice's course
    [, , protocolFee] = await createTransaction(knowledgeLayerEscrow, bob, bobId);

    // Alice wants to raise a dispute and pays the arbitration fee
    await knowledgeLayerEscrow.connect(bob).payArbitrationFeeBySender(transactionId, {
      value: arbitrationCost,
    });

    // Simulate arbitration fee timeout expiration
    await time.increase(ARBITRATION_FEE_TIMEOUT);
  });

  describe('Trigger arbitration fee timeout', function () {
    let tx: ContractTransaction;

    before(async function () {
      tx = await knowledgeLayerEscrow.connect(bob).arbitrationFeeTimeout(transactionId);
    });

    it('The transaction data is updated correctly', async function () {
      const transaction = await knowledgeLayerEscrow.connect(bob).getTransaction(transactionId);
      expect(transaction.status).to.be.eq(TransactionStatus.Resolved);
      expect(transaction.senderFee).to.be.eq(0);
      expect(transaction.receiverFee).to.be.eq(0);
    });

    it('The sender receives escrow funds and gets arbitration fee reimbursed', async function () {
      const totalAmountSent = transactionAmount
        .add(transactionAmount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER))
        .add(arbitrationCost);

      await expect(tx).to.changeEtherBalances(
        [bob.address, knowledgeLayerEscrow.address],
        [totalAmountSent, totalAmountSent.mul(-1)],
      );
    });
  });
});
