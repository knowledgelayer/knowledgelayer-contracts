import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import deploy from '../utils/deploy';
import { FEE_DIVIDER, MintStatus, PROTOCOL_INDEX } from '../utils/constants';
import { expect } from 'chai';

describe('Full Workflow', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgeLayerEscrow: KnowledgeLayerEscrow;

  const aliceId = 1;
  const bobId = 2;
  const carolPlatformId = 1;
  const davePlatformId = 2;
  const originFee = 200;
  const buyFee = 300;
  const transactionId = 1;

  const courseId = 1;
  const coursePrice = 100;
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';

  before(async () => {
    [deployer, alice, bob, carol, dave] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID, knowledgeLayerCourse, knowledgeLayerEscrow] =
      await deploy();

    // Add carol to whitelist and mint platform IDs
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(dave.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    await knowledgeLayerPlatformID.connect(dave).mint('dave-platform');

    // Update platform fees
    await knowledgeLayerPlatformID.connect(carol).updateOriginFee(carolPlatformId, originFee);
    await knowledgeLayerPlatformID.connect(dave).updateBuyFee(davePlatformId, buyFee);

    // Disable whitelist and mint IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(PROTOCOL_INDEX, 'alice');
    await knowledgeLayerID.connect(bob).mint(PROTOCOL_INDEX, 'bob__');

    // Alice creates a course
    await knowledgeLayerCourse
      .connect(alice)
      .createCourse(aliceId, carolPlatformId, coursePrice, courseDataUri);
  });

  describe('Buy course', async () => {
    let tx: ContractTransaction;
    let totalPrice: number;

    before(async () => {
      const originFee = await knowledgeLayerPlatformID.getOriginFee(carolPlatformId);
      const buyFee = await knowledgeLayerPlatformID.getBuyFee(davePlatformId);
      const protocolFee = await knowledgeLayerEscrow.protocolFee();
      totalPrice = coursePrice + (coursePrice * (originFee + buyFee + protocolFee)) / FEE_DIVIDER;

      // Bob buys Alice's course
      tx = await knowledgeLayerEscrow
        .connect(bob)
        .createTransaction(bobId, courseId, davePlatformId, {
          value: totalPrice,
        });
      await tx.wait();
    });

    it('Mints a course token to the buyer', async () => {
      const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
      expect(balance).to.equal(1);
    });

    it('Sends funds to escrow', async () => {
      await expect(tx).to.changeEtherBalances(
        [bob, knowledgeLayerEscrow],
        [-totalPrice, totalPrice],
      );
    });
  });

  describe('Release funds to seller', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Alice claims the funds
      tx = await knowledgeLayerEscrow.connect(alice).release(aliceId, transactionId);
      await tx.wait();
    });

    it('Sends funds to Alice', async () => {
      await expect(tx).to.changeEtherBalances(
        [knowledgeLayerEscrow, alice],
        [-coursePrice, coursePrice],
      );
    });

    it('Updates platforms balances with fees', async () => {
      const originFeeAmount = (coursePrice * originFee) / FEE_DIVIDER;
      const buyFeeAmount = (coursePrice * buyFee) / FEE_DIVIDER;

      const originPlatformBalance = await knowledgeLayerEscrow.platformBalance(carolPlatformId);
      const buyPlatformBalance = await knowledgeLayerEscrow.platformBalance(davePlatformId);

      expect(originPlatformBalance).to.equal(originFeeAmount);
      expect(buyPlatformBalance).to.equal(buyFeeAmount);
    });

    it('Updates protocol balance with fees', async () => {
      const protocolFee = await knowledgeLayerEscrow.protocolFee();
      const protocolFeeAmount = (coursePrice * protocolFee) / FEE_DIVIDER;

      const protocolBalance = await knowledgeLayerEscrow.platformBalance(PROTOCOL_INDEX);
      expect(protocolBalance).to.equal(protocolFeeAmount);
    });
  });

  describe('Claim platform fees', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Carol claims platform fees
      tx = await knowledgeLayerEscrow.connect(carol).claim(carolPlatformId);
      await tx.wait();
    });

    it('Sends funds to the platform owner', async () => {
      const originFeeAmount = (coursePrice * originFee) / FEE_DIVIDER;

      await expect(tx).to.changeEtherBalances(
        [carol, knowledgeLayerEscrow],
        [originFeeAmount, -originFeeAmount],
      );
    });

    it('Updates the platform balance', async () => {
      const originPlatformBalance = await knowledgeLayerEscrow.platformBalance(carolPlatformId);
      expect(originPlatformBalance).to.equal(0);
    });
  });

  describe('Claim protocol fees', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Carol claims platform fees
      tx = await knowledgeLayerEscrow.connect(deployer).claim(PROTOCOL_INDEX);
      await tx.wait();
    });

    it('Sends funds to the platform owner', async () => {
      const protocolFee = await knowledgeLayerEscrow.protocolFee();
      const protocolFeeAmount = (coursePrice * protocolFee) / FEE_DIVIDER;
      const protocolTreasuryAddress = await knowledgeLayerEscrow.protocolTreasuryAddress();

      await expect(tx).to.changeEtherBalances(
        [protocolTreasuryAddress, knowledgeLayerEscrow],
        [protocolFeeAmount, -protocolFeeAmount],
      );
    });

    it('Updates the protocol balance', async () => {
      const protocolBalance = await knowledgeLayerEscrow.platformBalance(PROTOCOL_INDEX);
      expect(protocolBalance).to.equal(0);
    });
  });
});
