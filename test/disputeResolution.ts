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
} from '../utils/constants';
import { deploy } from '../utils/deploy';

const aliceId = 1;
const bobId = 2;
const courseId = 1;
const carolPlatformId = 1;
const coursePrice = ethers.utils.parseEther('0.01');
const courseDisputePeriod = 60 * 60 * 24 * 7; // 7 days
const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
const transactionId = 1;
const transactionAmount = ethers.utils.parseEther('100');
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
  [KnowledgeLayerPlatformID, KnowledgeLayerEscrow, KnowledgeLayerArbitrator, KnowledgeLayerCourse]
> {
  const [deployer, alice, bob, carol] = await ethers.getSigners();
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
  await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
  const carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);

  // Mint KnowledgeLayer IDs
  await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
  await knowledgeLayerID.connect(alice).mint(carolPlatformId, 'alice');
  await knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__');

  // Add KnowledgeLayerArbitrator to platform available arbitrators
  await knowledgeLayerPlatformID
    .connect(deployer)
    .addArbitrator(knowledgeLayerArbitrator.address, true);

  // Update platform arbitrator, and fee timeout
  await knowledgeLayerPlatformID
    .connect(carol)
    .updateArbitrator(carolPlatformId, knowledgeLayerArbitrator.address, []);
  await knowledgeLayerPlatformID
    .connect(carol)
    .updateArbitrationFeeTimeout(carolPlatformId, arbitrationFeeTimeout);

  // Update arbitration cost
  await knowledgeLayerArbitrator
    .connect(carol)
    .setArbitrationPrice(carolPlatformId, arbitrationCost);

  // Alice creates a course
  await knowledgeLayerCourse
    .connect(alice)
    .createCourse(
      aliceId,
      carolPlatformId,
      coursePrice,
      tokenAddress,
      courseDisputePeriod,
      courseDataUri,
    );

  return [
    knowledgeLayerPlatformID,
    knowledgeLayerEscrow,
    knowledgeLayerArbitrator,
    knowledgeLayerCourse,
  ];
}

async function getTransactionDetails(
  knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
  knowledgeLayerEscrow: KnowledgeLayerEscrow,
): Promise<[BigNumber, number, number, number]> {
  const platform = await knowledgeLayerPlatformID.platforms(carolPlatformId);
  const protocolEscrowFeeRate = await knowledgeLayerEscrow.protocolFee();
  const originCourseFeeRate = platform.originFee;
  const originValidatedProposalFeeRate = platform.buyFee;
  const totalTransactionAmount = transactionAmount.add(
    transactionAmount
      .mul(protocolEscrowFeeRate + originValidatedProposalFeeRate + originCourseFeeRate)
      .div(FEE_DIVIDER),
  );

  return [
    totalTransactionAmount,
    protocolEscrowFeeRate,
    originCourseFeeRate,
    originValidatedProposalFeeRate,
  ];
}

async function createTransaction(
  knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
  knowledgeLayerCourse: KnowledgeLayerCourse,
  knowledgeLayerEscrow: KnowledgeLayerEscrow,
  signer: SignerWithAddress,
  profileId: number,
): Promise<[ContractTransaction, BigNumber, number, number, number]> {
  // Create transaction
  const [
    totalTransactionAmount,
    protocolEscrowFeeRate,
    originCourseFeeRate,
    originValidatedProposalFeeRate,
  ] = await getTransactionDetails(knowledgeLayerPlatformID, knowledgeLayerEscrow);

  const course = await knowledgeLayerCourse.getCourse(courseId);
  const originFee = await knowledgeLayerPlatformID.getOriginFee(course.platformId);
  const buyFee = await knowledgeLayerPlatformID.getBuyFee(carolPlatformId);
  const protocolFee = await knowledgeLayerEscrow.protocolFee();
  const totalPrice = coursePrice.add(
    coursePrice.mul(originFee + buyFee + protocolFee).div(FEE_DIVIDER),
  );
  const tx = await knowledgeLayerEscrow
    .connect(signer)
    .createTransaction(profileId, courseId, carolPlatformId, META_EVIDENCE_CID, {
      value: totalPrice,
    });

  return [
    tx,
    totalTransactionAmount,
    protocolEscrowFeeRate,
    originCourseFeeRate,
    originValidatedProposalFeeRate,
  ];
}

describe.only('Dispute Resolution, standard flow', () => {
  let alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    knowledgeLayerArbitrator: KnowledgeLayerArbitrator,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    protocolFee: number,
    originFee: number,
    buyFee: number,
    platform: KnowledgeLayerPlatformID.PlatformStructOutput;

  const newArbitrationCost = BigNumber.from(8);
  const arbitrationCostDifference = arbitrationCost.sub(newArbitrationCost);

  before(async () => {
    [, alice, bob, carol, dave] = await ethers.getSigners();
    [
      knowledgeLayerPlatformID,
      knowledgeLayerEscrow,
      knowledgeLayerArbitrator,
      knowledgeLayerCourse,
    ] = await deployAndSetup(ARBITRATION_FEE_TIMEOUT, ETH_ADDRESS);
  });

  describe('Submit meta evidence', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Create transaction, Bob buys Alice's course
      [tx, , protocolFee, originFee, buyFee] = await createTransaction(
        knowledgeLayerPlatformID,
        knowledgeLayerCourse,
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
      const tx = knowledgeLayerEscrow.connect(carol).payArbitrationFeeBySender(transactionId, {
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
        .setArbitrationPrice(carolPlatformId, newArbitrationCost);
    });

    it('Fails if the transaction does not have an arbitrator set', async () => {
      const tx = knowledgeLayerEscrow.connect(alice).payArbitrationFeeByReceiver(0, {
        value: newArbitrationCost,
      });
      await expect(tx).to.be.revertedWith('Arbitrator not set');
    });

    it('Fails if is not called by the receiver of the transaction', async () => {
      const tx = knowledgeLayerEscrow.connect(carol).payArbitrationFeeByReceiver(transactionId, {
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

        // Fee paid by receiver is updated correctly
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
        expect(dispute.platformId).to.be.eq(carolPlatformId);

        const status = await knowledgeLayerArbitrator.disputeStatus(disputeId);
        const ruling = await knowledgeLayerArbitrator.currentRuling(disputeId);
        expect(status).to.be.eq(DisputeStatus.Waiting);
        expect(ruling).to.be.eq(0);
      });
    });
  });
});
