import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import uploadToIPFS from '../utils/uploadToIpfs';
import deploy from '../utils/deploy';
import { FEE_DIVIDER, MintStatus } from '../utils/constants';
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
  const courseData = {
    title: 'My cool course',
    description:
      'Lorem ipsum dolor sit amet consectetur adipisicing elit. Blanditiis, velit rerum reprehenderit natus omnis eligendi iure amet fugit assumenda cumque id ad qui quos alias odit iusto provident. Nostrum accusamus quae iure quod maiores!',
    image:
      'https://yvgbeqzuvfqmewtltglq.supabase.co/storage/v1/object/public/public/16814021907992.webp',
    videoPlaybackId: 'a915y3226a68zhp7',
  };

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
    await knowledgeLayerID.connect(alice).mint(0, 'alice');
    await knowledgeLayerID.connect(bob).mint(0, 'bob__');

    // Alice creates a course
    const uri = await uploadToIPFS(courseData);
    if (!uri) throw new Error('Failed to upload to IPFS');

    await knowledgeLayerCourse
      .connect(alice)
      .createCourse(aliceId, carolPlatformId, coursePrice, uri);
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

    it('Mints a course token to Bob', async () => {
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

      const protocolBalance = await knowledgeLayerEscrow.platformBalance(0);
      expect(protocolBalance).to.equal(protocolFeeAmount);
    });
  });
});
