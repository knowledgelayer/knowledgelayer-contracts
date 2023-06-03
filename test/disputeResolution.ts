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
  ERC20,
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
  PROTOCOL_INDEX,
} from '../utils/constants';
import { deploy } from '../utils/deploy';

const receiverId = 1;
const senderId = 2;
const daveId = 3;
const originPlatformId = 1;
const buyPlatformId = 2;
const protocolFee = 100;
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
const NO_WINNER = 0;
const SENDER_WINS = 1;
const RECEIVER_WINS = 2;

function getTransactionAmountWithFees(amount: BigNumber) {
  return amount.add(amount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER));
}

/**
 * Deploys contract and sets up the context for dispute resolution.
 * @param arbitrationFeeTimeout the timeout for the arbitration fee
 * @param tokenAddress the payment token used for this case
 * @returns the deployed contracts
 */
async function deployAndSetup(
  tokenAddress: string,
): Promise<
  [KnowledgeLayerPlatformID, KnowledgeLayerCourse, KnowledgeLayerEscrow, KnowledgeLayerArbitrator]
> {
  const [deployer, sender, receiver, carol, dave] = await ethers.getSigners();
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

  // Update protocol fees
  await knowledgeLayerEscrow.connect(deployer).setProtocolFee(protocolFee);

  // Mint KnowledgeLayer IDs
  await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
  await knowledgeLayerID.connect(receiver).mint(originPlatformId, 'receiver');
  await knowledgeLayerID.connect(sender).mint(originPlatformId, 'sender__');
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
    .updateArbitrationFeeTimeout(originPlatformId, ARBITRATION_FEE_TIMEOUT);

  // Update arbitration cost
  await knowledgeLayerArbitrator
    .connect(carol)
    .setArbitrationPrice(originPlatformId, arbitrationCost);

  // Receiver creates a course
  await knowledgeLayerCourse
    .connect(receiver)
    .createCourse(
      receiverId,
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

describe('Dispute Resolution', async () => {
  describe('Sender wins', () => {
    let sender: SignerWithAddress,
      receiver: SignerWithAddress,
      carol: SignerWithAddress,
      dave: SignerWithAddress,
      knowledgeLayerEscrow: KnowledgeLayerEscrow,
      knowledgeLayerArbitrator: KnowledgeLayerArbitrator;

    const newArbitrationCost = ethers.utils.parseEther('0.008');
    const arbitrationCostDifference = arbitrationCost.sub(newArbitrationCost);

    before(async () => {
      [, sender, receiver, carol, dave] = await ethers.getSigners();
      [, , knowledgeLayerEscrow, knowledgeLayerArbitrator] = await deployAndSetup(ETH_ADDRESS);
    });

    describe('Submit meta evidence', async () => {
      let tx: ContractTransaction;

      before(async () => {
        // Create transaction, sender buys receiver's course
        const totalTransactionAmount = getTransactionAmountWithFees(transactionAmount);
        tx = await knowledgeLayerEscrow
          .connect(sender)
          .createTransaction(senderId, courseId, buyPlatformId, META_EVIDENCE_CID, {
            value: totalTransactionAmount,
          });
      });

      it('Meta evidence is submitted', async () => {
        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'MetaEvidence')
          .withArgs(transactionId, META_EVIDENCE_CID);
      });
    });

    describe('Attempt to open dispute by receiver', async () => {
      it("Receiver can't open a dispute", async () => {
        const tx = knowledgeLayerEscrow
          .connect(receiver)
          .payArbitrationFeeByReceiver(transactionId, {
            value: arbitrationCost,
          });
        await expect(tx).to.be.revertedWith('Receiver does not have to pay');
      });
    });

    describe('Payment of arbitration fee by sender', async () => {
      it('Fails if the transaction does not have an arbitrator set', async () => {
        const tx = knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(0, {
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
        const tx = knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
          value: arbitrationCost.sub(1),
        });
        await expect(tx).to.be.revertedWith('The sender fee must be equal to the arbitration cost');
      });

      describe('Successful payment of arbitration fee', async () => {
        let tx: ContractTransaction;

        before(async () => {
          // Sender pays arbitration fee to open a dispute
          tx = await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
            value: arbitrationCost,
          });
        });

        it('Arbitration fee is sent from sender to escrow', async () => {
          await expect(tx).to.changeEtherBalances(
            [sender.address, knowledgeLayerEscrow.address],
            [arbitrationCost.mul(-1), arbitrationCost],
          );
        });

        it('The transaction data is updated correctly', async () => {
          const transaction = await knowledgeLayerEscrow
            .connect(sender)
            .getTransaction(transactionId);

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
        const tx = knowledgeLayerEscrow.connect(sender).arbitrationFeeTimeout(transactionId);
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
        const tx = knowledgeLayerEscrow.connect(receiver).payArbitrationFeeByReceiver(0, {
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
        const tx = knowledgeLayerEscrow
          .connect(receiver)
          .payArbitrationFeeByReceiver(transactionId, {
            value: newArbitrationCost.sub(1),
          });
        await expect(tx).to.be.revertedWith(
          'The receiver fee must be equal to the arbitration cost',
        );
      });

      describe('Successful payment of arbitration fee', async () => {
        let tx: ContractTransaction;

        before(async () => {
          tx = await knowledgeLayerEscrow
            .connect(receiver)
            .payArbitrationFeeByReceiver(transactionId, {
              value: newArbitrationCost,
            });
        });

        it('The arbitration fee is sent to the arbitrator', async () => {
          await expect(tx).to.changeEtherBalances(
            [receiver.address, knowledgeLayerEscrow.address, knowledgeLayerArbitrator.address],
            [newArbitrationCost.mul(-1), arbitrationCostDifference.mul(-1), newArbitrationCost],
          );
        });

        it('Sender is reimbursed for overpaying arbitration fee', async () => {
          await expect(tx).to.changeEtherBalances([sender.address], [arbitrationCostDifference]);
        });

        it('The transaction data is updated correctly', async () => {
          const transaction = await knowledgeLayerEscrow
            .connect(receiver)
            .getTransaction(transactionId);

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
        const tx = knowledgeLayerEscrow.connect(receiver).release(receiverId, transactionId);
        await expect(tx).to.be.revertedWith('Transaction is in dispute');
      });
    });

    describe('Submission of Evidence', async () => {
      it('Fails if the transaction does not have an arbitrator set', async () => {
        const tx = knowledgeLayerEscrow.connect(sender).submitEvidence(senderId, 0, EVIDENCE_CID);
        await expect(tx).to.be.revertedWith('Arbitrator not set');
      });

      it('Fails if the cid is invalid', async () => {
        const tx = knowledgeLayerEscrow.connect(sender).submitEvidence(senderId, transactionId, '');
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
          .connect(sender)
          .submitEvidence(senderId, transactionId, EVIDENCE_CID);
        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'Evidence')
          .withArgs(knowledgeLayerArbitrator.address, transactionId, sender.address, EVIDENCE_CID);
      });

      it('Receiver can submit evidence', async () => {
        const tx = await knowledgeLayerEscrow
          .connect(receiver)
          .submitEvidence(receiverId, transactionId, EVIDENCE_CID);
        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'Evidence')
          .withArgs(
            knowledgeLayerArbitrator.address,
            transactionId,
            receiver.address,
            EVIDENCE_CID,
          );
      });
    });

    describe('Submission of a ruling', async () => {
      it('Fails if ruling is not given by the arbitrator contract', async () => {
        const tx = knowledgeLayerEscrow.connect(dave).rule(disputeId, SENDER_WINS);
        await expect(tx).to.be.revertedWith('The caller must be the arbitrator');
      });

      describe('Successful submission of a ruling', async () => {
        let tx: ContractTransaction;

        before(async () => {
          // Rule in favor of the sender (sender)
          tx = await knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, SENDER_WINS);
        });

        it('The winner of the dispute (sender) receives escrow funds and gets arbitration fee reimbursed', async () => {
          // Calculate total sent amount, including fees and arbitration cost reimbursement
          const totalAmountSent = transactionAmount
            .add(transactionAmount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER))
            .add(newArbitrationCost);

          await expect(tx).to.changeEtherBalances(
            [sender.address, knowledgeLayerEscrow.address],
            [totalAmountSent, totalAmountSent.mul(-1)],
          );
        });

        it('The owner of the platform receives the arbitration fee', async () => {
          await expect(tx).to.changeEtherBalances(
            [carol.address, knowledgeLayerArbitrator.address],
            [newArbitrationCost, newArbitrationCost.mul(-1)],
          );
        });

        it('The transaction data is updated correctly', async () => {
          const transaction = await knowledgeLayerEscrow
            .connect(sender)
            .getTransaction(transactionId);
          expect(transaction.status).to.be.eq(TransactionStatus.Resolved);
          expect(transaction.senderFee).to.be.eq(0);
          expect(transaction.receiverFee).to.be.eq(newArbitrationCost);
        });

        it('Dispute data is updated correctly', async () => {
          const status = await knowledgeLayerArbitrator.disputeStatus(disputeId);
          const ruling = await knowledgeLayerArbitrator.currentRuling(disputeId);
          expect(status).to.be.eq(DisputeStatus.Solved);
          expect(ruling).to.be.eq(SENDER_WINS);
        });

        it('Emits the Payment event', async () => {
          await expect(tx)
            .to.emit(knowledgeLayerEscrow, 'Payment')
            .withArgs(transactionId, PaymentType.Reimburse, transactionAmount);
        });
      });
    });

    describe('Appealing a ruling', async () => {
      it('Fails if the transaction does not have an arbitrator set', async () => {
        const tx = knowledgeLayerEscrow.connect(sender).appeal(0);
        await expect(tx).to.be.revertedWith('Arbitrator not set');
      });

      it('Fails because cost is too high', async () => {
        const tx = knowledgeLayerEscrow.connect(sender).appeal(transactionId, {
          value: ethers.utils.parseEther('100'),
        });
        await expect(tx).to.be.revertedWith('Not enough ETH to cover appeal costs.');
      });
    });

    describe('Attempt to do dispute actions on a resolved dispute', async () => {
      it('Fails to pay arbitration fee by sender on resolved dispute', async () => {
        const tx = knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
          value: newArbitrationCost,
        });
        await expect(tx).to.be.revertedWith('Dispute already created');
      });

      it('Fails to submit evidence on resolved dispute', async () => {
        const tx = knowledgeLayerEscrow
          .connect(sender)
          .submitEvidence(senderId, transactionId, EVIDENCE_CID);
        await expect(tx).to.be.revertedWith('Must not send evidence if the dispute is resolved');
      });

      it('Submission of ruling fails if the dispute is already solved', async () => {
        const tx = knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, SENDER_WINS);
        await expect(tx).to.be.revertedWith('The dispute must not be solved already.');
      });
    });
  });

  describe('Receiver wins', () => {
    let sender: SignerWithAddress,
      receiver: SignerWithAddress,
      carol: SignerWithAddress,
      knowledgeLayerEscrow: KnowledgeLayerEscrow,
      knowledgeLayerArbitrator: KnowledgeLayerArbitrator,
      tx: ContractTransaction;

    const initialArbitrationCost = arbitrationCost;
    const intermediateArbitrationCost = ethers.utils.parseEther('0.012');
    const finalArbitrationCost = ethers.utils.parseEther('0.011');

    before(async () => {
      [, sender, receiver, carol] = await ethers.getSigners();
      [, , knowledgeLayerEscrow, knowledgeLayerArbitrator] = await deployAndSetup(ETH_ADDRESS);

      // Create transaction, sender buys receiver's course
      const totalTransactionAmount = getTransactionAmountWithFees(transactionAmount);
      await knowledgeLayerEscrow
        .connect(sender)
        .createTransaction(senderId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: totalTransactionAmount,
        });

      // Sender wants to raise a dispute and pays the arbitration fee
      await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
        value: initialArbitrationCost,
      });

      // Arbitration fee increases
      await knowledgeLayerArbitrator
        .connect(carol)
        .setArbitrationPrice(originPlatformId, intermediateArbitrationCost);

      // Receiver pays arbitration fee
      await knowledgeLayerEscrow.connect(receiver).payArbitrationFeeByReceiver(transactionId, {
        value: intermediateArbitrationCost,
      });

      // Arbitration fee decreases
      await knowledgeLayerArbitrator
        .connect(carol)
        .setArbitrationPrice(originPlatformId, finalArbitrationCost);

      // Sender pays remaining arbitration fee and dispute is created
      tx = await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
        value: finalArbitrationCost.sub(initialArbitrationCost),
      });
    });

    it('Receiver is reimbursed for overpaying arbitration fee', async () => {
      const overPaidAmount = intermediateArbitrationCost.sub(finalArbitrationCost);

      const escrowInputAmount = finalArbitrationCost.sub(initialArbitrationCost); // Remaining arbitration fee paid by sender
      const escrowOutboundAmount = finalArbitrationCost.add(overPaidAmount);
      const escrowBalanceChange = escrowInputAmount.add(escrowOutboundAmount.mul(-1));

      await expect(tx).to.changeEtherBalances(
        [receiver.address, knowledgeLayerEscrow.address],
        [overPaidAmount, escrowBalanceChange],
      );
    });

    describe('Submission of a ruling', async () => {
      let tx: ContractTransaction;

      before(async () => {
        // Rule in favor of the sender
        tx = await knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, RECEIVER_WINS);
      });

      it('The winner of the dispute (receiver) receives escrow funds and gets arbitration fee reimbursed', async () => {
        const totalAmountSent = transactionAmount.add(finalArbitrationCost);
        await expect(tx).to.changeEtherBalances(
          [receiver.address, knowledgeLayerEscrow.address],
          [totalAmountSent, totalAmountSent.mul(-1)],
        );
      });

      it('The owner of the platform receives the arbitration fee', async () => {
        await expect(tx).to.changeEtherBalances(
          [carol.address, knowledgeLayerArbitrator.address],
          [finalArbitrationCost, finalArbitrationCost.mul(-1)],
        );
      });

      it('Emits the Payment event', async () => {
        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'Payment')
          .withArgs(transactionId, PaymentType.Release, transactionAmount);
      });
    });
  });

  describe('Arbitrator abstains from giving a ruling', () => {
    let sender: SignerWithAddress,
      receiver: SignerWithAddress,
      carol: SignerWithAddress,
      knowledgeLayerEscrow: KnowledgeLayerEscrow,
      knowledgeLayerArbitrator: KnowledgeLayerArbitrator;

    before(async () => {
      [, sender, receiver, carol] = await ethers.getSigners();
      [, , knowledgeLayerEscrow, knowledgeLayerArbitrator] = await deployAndSetup(ETH_ADDRESS);

      // Create transaction, sender buys receiver's course
      const totalTransactionAmount = getTransactionAmountWithFees(transactionAmount);
      await knowledgeLayerEscrow
        .connect(sender)
        .createTransaction(senderId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: totalTransactionAmount,
        });

      // Sender wants to raise a dispute and pays the arbitration fee
      await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
        value: arbitrationCost,
      });

      // Receiver pays arbitration fee and dispute id created
      await knowledgeLayerEscrow.connect(receiver).payArbitrationFeeByReceiver(transactionId, {
        value: arbitrationCost,
      });
    });

    describe('The arbitrator abstains from giving a ruling', async () => {
      let tx: ContractTransaction, halfTransactionAmount: BigNumber, halfArbitrationCost: BigNumber;

      before(async () => {
        tx = await knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, NO_WINNER);
        halfTransactionAmount = transactionAmount.div(2);
        halfArbitrationCost = arbitrationCost.div(2);
      });

      it('Split funds and arbitration fee half and half between the parties', async () => {
        // Half of transaction amount (+ fees) and half of arbitration cost is sent to the sender
        const senderAmount =
          getTransactionAmountWithFees(halfTransactionAmount).add(halfArbitrationCost);

        // Half of transaction amount and half of arbitration cost is sent to the receiver
        const receiverAmount = halfTransactionAmount.add(halfArbitrationCost);

        await expect(tx).to.changeEtherBalances(
          [sender.address, receiver.address, knowledgeLayerEscrow.address],
          [senderAmount, receiverAmount, senderAmount.add(receiverAmount).mul(-1)],
        );
      });

      it('Increases platform and protocol fees balance', async () => {
        const originPlatformBalance = await knowledgeLayerEscrow
          .connect(carol)
          .platformBalance(originPlatformId, ETH_ADDRESS);
        const buyPlatformBalance = await knowledgeLayerEscrow
          .connect(carol)
          .platformBalance(buyPlatformId, ETH_ADDRESS);
        const protocolBalance = await knowledgeLayerEscrow
          .connect(carol)
          .platformBalance(PROTOCOL_INDEX, ETH_ADDRESS);

        const originFeeAmount = halfTransactionAmount.mul(originFee).div(FEE_DIVIDER);
        const buyFeeAmount = halfTransactionAmount.mul(buyFee).div(FEE_DIVIDER);
        const protocolFeeAmount = halfTransactionAmount.mul(protocolFee).div(FEE_DIVIDER);

        expect(originPlatformBalance).to.be.eq(originFeeAmount);
        expect(buyPlatformBalance).to.be.eq(buyFeeAmount);
        expect(protocolBalance).to.be.eq(protocolFeeAmount);
      });

      it('Emits the Payment events', async () => {
        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'Payment')
          .withArgs(transactionId, PaymentType.Release, halfTransactionAmount);

        await expect(tx)
          .to.emit(knowledgeLayerEscrow, 'Payment')
          .withArgs(transactionId, PaymentType.Reimburse, halfTransactionAmount);
      });
    });
  });

  describe('Receiver fails to pay arbitration fee on time', () => {
    let sender: SignerWithAddress, knowledgeLayerEscrow: KnowledgeLayerEscrow;

    before(async () => {
      [, sender] = await ethers.getSigners();
      [, , knowledgeLayerEscrow] = await deployAndSetup(ETH_ADDRESS);

      // Create transaction, sender buys receiver's course
      const totalTransactionAmount = getTransactionAmountWithFees(transactionAmount);
      await knowledgeLayerEscrow
        .connect(sender)
        .createTransaction(senderId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: totalTransactionAmount,
        });

      // Sender wants to raise a dispute and pays the arbitration fee
      await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
        value: arbitrationCost,
      });

      // Simulate arbitration fee timeout expiration
      await time.increase(ARBITRATION_FEE_TIMEOUT);
    });

    describe('Trigger arbitration fee timeout', () => {
      let tx: ContractTransaction;

      before(async () => {
        tx = await knowledgeLayerEscrow.connect(sender).arbitrationFeeTimeout(transactionId);
      });

      it('The transaction data is updated correctly', async () => {
        const transaction = await knowledgeLayerEscrow
          .connect(sender)
          .getTransaction(transactionId);
        expect(transaction.status).to.be.eq(TransactionStatus.Resolved);
        expect(transaction.senderFee).to.be.eq(0);
        expect(transaction.receiverFee).to.be.eq(0);
      });

      it('The sender gets escrow funds and gets arbitration fee reimbursed', async () => {
        const totalAmountSent = transactionAmount
          .add(transactionAmount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER))
          .add(arbitrationCost);

        await expect(tx).to.changeEtherBalances(
          [sender.address, knowledgeLayerEscrow.address],
          [totalAmountSent, totalAmountSent.mul(-1)],
        );
      });
    });
  });

  describe('Sender fails to pay arbitration fee on time', () => {
    let sender: SignerWithAddress,
      receiver: SignerWithAddress,
      carol: SignerWithAddress,
      knowledgeLayerEscrow: KnowledgeLayerEscrow,
      knowledgeLayerArbitrator: KnowledgeLayerArbitrator;

    const newArbitrationCost = ethers.utils.parseEther('0.015');

    before(async () => {
      [, sender, receiver, carol] = await ethers.getSigners();
      [, , knowledgeLayerEscrow, knowledgeLayerArbitrator] = await deployAndSetup(ETH_ADDRESS);

      // Create transaction, sender buys receiver's course
      const totalTransactionAmount = getTransactionAmountWithFees(transactionAmount);
      await knowledgeLayerEscrow
        .connect(sender)
        .createTransaction(senderId, courseId, buyPlatformId, META_EVIDENCE_CID, {
          value: totalTransactionAmount,
        });

      // Sender wants to raise a dispute and pays the arbitration fee
      await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
        value: arbitrationCost,
      });

      // Arbitration cost inreases
      await knowledgeLayerArbitrator
        .connect(carol)
        .setArbitrationPrice(originPlatformId, newArbitrationCost);

      // Receiver pays arbitration fee to open the dispute
      await knowledgeLayerEscrow.connect(receiver).payArbitrationFeeByReceiver(transactionId, {
        value: newArbitrationCost,
      });

      // Simulate arbitration fee timeout expiration
      await time.increase(ARBITRATION_FEE_TIMEOUT);
    });

    describe('Trigger arbitration fee timeout', () => {
      let tx: ContractTransaction;

      before(async () => {
        tx = await knowledgeLayerEscrow.connect(receiver).arbitrationFeeTimeout(transactionId);
      });

      it('The transaction data is updated correctly', async () => {
        const transaction = await knowledgeLayerEscrow
          .connect(sender)
          .getTransaction(transactionId);
        expect(transaction.status).to.be.eq(TransactionStatus.Resolved);
        expect(transaction.senderFee).to.be.eq(0);
        expect(transaction.receiverFee).to.be.eq(0);
      });

      it('The receiver gets escrow funds and parties get arbitration fee reimbursed', async () => {
        await expect(tx).to.changeEtherBalances(
          [sender.address, receiver.address, knowledgeLayerEscrow.address],
          [
            arbitrationCost,
            transactionAmount.add(newArbitrationCost),
            transactionAmount.add(arbitrationCost).add(newArbitrationCost).mul(-1),
          ],
        );
      });
    });
  });

  describe('With ERC20 token transaction', () => {
    let deployer: SignerWithAddress,
      sender: SignerWithAddress,
      receiver: SignerWithAddress,
      carol: SignerWithAddress,
      knowledgeLayerEscrow: KnowledgeLayerEscrow,
      knowledgeLayerArbitrator: KnowledgeLayerArbitrator,
      simpleERC20: ERC20;

    before(async () => {
      [deployer, sender, receiver, carol] = await ethers.getSigners();

      // Deploy SimpleERC20
      const SimpleERC20 = await ethers.getContractFactory('SimpleERC20');
      simpleERC20 = await SimpleERC20.deploy();
      simpleERC20.deployed();

      [, , knowledgeLayerEscrow, knowledgeLayerArbitrator] = await deployAndSetup(
        simpleERC20.address,
      );

      // Send tokens to sender
      const balance = await simpleERC20.balanceOf(deployer.address);
      simpleERC20.connect(deployer).transfer(sender.address, balance);

      // Approve tokens to escrow
      const totalTransactionAmount = getTransactionAmountWithFees(transactionAmount);
      await simpleERC20
        .connect(sender)
        .approve(knowledgeLayerEscrow.address, totalTransactionAmount);

      // Create transaction, sender buys receiver's course
      await knowledgeLayerEscrow
        .connect(sender)
        .createTransaction(senderId, courseId, buyPlatformId, META_EVIDENCE_CID);

      // Sender wants to raise a dispute and pays the arbitration fee
      await knowledgeLayerEscrow.connect(sender).payArbitrationFeeBySender(transactionId, {
        value: arbitrationCost,
      });

      // Receiver pays arbitration fee and dispute id created
      await knowledgeLayerEscrow.connect(receiver).payArbitrationFeeByReceiver(transactionId, {
        value: arbitrationCost,
      });
    });

    describe('Successful submission of a ruling', async () => {
      let tx: ContractTransaction;

      before(async () => {
        // Rule in favor of the sender
        tx = await knowledgeLayerArbitrator.connect(carol).giveRuling(disputeId, SENDER_WINS);
      });

      it('The winner of the dispute receives escrow funds and gets arbitration fee reimbursed', async () => {
        const totalAmountSent = transactionAmount.add(
          transactionAmount.mul(protocolFee + originFee + buyFee).div(FEE_DIVIDER),
        );

        await expect(tx).to.changeTokenBalances(
          simpleERC20,
          [sender.address, knowledgeLayerEscrow.address],
          [totalAmountSent, totalAmountSent.mul(-1)],
        );
      });
    });
  });
});
