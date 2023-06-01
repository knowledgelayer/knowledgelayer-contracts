import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
  KnowledgeLayerReview,
} from '../typechain-types';
import deploy from '../utils/deploy';
import { ETH_ADDRESS, FEE_DIVIDER, MintStatus } from '../utils/constants';

describe('KnowledgeLayerReview', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    knowledgeLayerReview: KnowledgeLayerReview;

  const aliceId = BigNumber.from(1);
  const bobId = BigNumber.from(2);
  const carolId = BigNumber.from(3);
  const courseId = 1;
  const coursePrice = ethers.utils.parseEther('0.01');
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
  const reviewDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

  before(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();
    [
      knowledgeLayerID,
      knowledgeLayerPlatformID,
      knowledgeLayerCourse,
      knowledgeLayerEscrow,
      knowledgeLayerReview,
    ] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);

    // Mint KnowledgeLayer IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(carolPlatformId, 'alice');
    await knowledgeLayerID.connect(bob).mint(carolPlatformId, 'bob__');
    await knowledgeLayerID.connect(carol).mint(carolPlatformId, 'carol');

    // Alice creates a course
    await knowledgeLayerCourse
      .connect(alice)
      .createCourse(aliceId, carolPlatformId, coursePrice, ETH_ADDRESS, courseDataUri);

    // Bob buys the course
    const course = await knowledgeLayerCourse.getCourse(courseId);
    const originFee = await knowledgeLayerPlatformID.getOriginFee(course.platformId);
    const buyFee = await knowledgeLayerPlatformID.getBuyFee(carolPlatformId);
    const protocolFee = await knowledgeLayerEscrow.protocolFee();
    const totalPrice = coursePrice.add(
      coursePrice.mul(originFee + buyFee + protocolFee).div(FEE_DIVIDER),
    );
    await knowledgeLayerEscrow.connect(bob).createTransaction(bobId, courseId, carolPlatformId, {
      value: totalPrice,
    });
  });

  describe('Create review', async () => {
    it("Can't review if not a buyer of the course", async () => {
      await expect(
        knowledgeLayerReview.connect(carol).mint(carolId, courseId, reviewDataUri, 5),
      ).to.be.revertedWith('Not a buyer of the course');
    });

    it("Rating can't be greater than 5", async () => {
      await expect(
        knowledgeLayerReview.connect(carol).mint(carolId, courseId, reviewDataUri, 6),
      ).to.be.revertedWith('Invalid rating');
    });
  });
});
