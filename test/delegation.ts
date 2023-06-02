import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
  KnowledgeLayerCourse,
  KnowledgeLayerEscrow,
  KnowledgeLayerReview,
} from '../typechain-types';
import { ETH_ADDRESS, FEE_DIVIDER, MintStatus } from '../utils/constants';
import deploy from '../utils/deploy';
import { BigNumber } from 'ethers';

describe('Delegation', function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    carol: SignerWithAddress,
    dave: SignerWithAddress,
    eve: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse,
    knowledgeLayerEscrow: KnowledgeLayerEscrow,
    knowledgeLayerReview: KnowledgeLayerReview;

  const aliceId = 1;
  const bobId = 2;
  const courseId = 1;
  const coursePrice = 100;
  const courseDisputePeriod = 60 * 60 * 24 * 7; // 7 days
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';
  const transactionId = 1;

  before(async function () {
    [deployer, alice, bob, carol, dave, eve] = await ethers.getSigners();
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
  });

  it('Can add a delegate', async () => {
    // Fails if the caller is not the owner of the profile
    const tx = knowledgeLayerID.connect(bob).addDelegate(aliceId, dave.address);
    await expect(tx).to.be.revertedWith('Not the owner');

    // Alice adds Dave as a delegate
    await knowledgeLayerID.connect(alice).addDelegate(aliceId, dave.address);
    const isDelegate = await knowledgeLayerID.isDelegate(aliceId, dave.address);
    expect(isDelegate).to.be.true;
  });

  it('Delegate can update profile on behalf of user', async () => {
    const dataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

    // Fails if caller is not the owner or delegate
    const failTx = knowledgeLayerID.connect(bob).updateProfileData(aliceId, dataUri);
    await expect(failTx).to.be.revertedWith('Not owner or delegate');

    const tx = await knowledgeLayerID.connect(dave).updateProfileData(aliceId, dataUri);
    await expect(tx).to.not.be.reverted;
  });

  it('Delegate can create course on behalf of user', async () => {
    const tx = await knowledgeLayerCourse
      .connect(dave)
      .createCourse(
        aliceId,
        carolPlatformId,
        coursePrice,
        ETH_ADDRESS,
        courseDisputePeriod,
        courseDataUri,
      );
    expect(tx).to.not.be.reverted;
  });

  it('Delegate can update course on behalf of user', async () => {
    const newCourseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

    const tx = await knowledgeLayerCourse
      .connect(dave)
      .updateCourse(
        aliceId,
        carolPlatformId,
        coursePrice,
        ETH_ADDRESS,
        courseDisputePeriod,
        newCourseDataUri,
      );
    expect(tx).to.not.be.reverted;
  });

  it('Delegate can release payment on behalf of user', async () => {
    // Bob buys Alice's course
    const originFee = await knowledgeLayerPlatformID.getOriginFee(carolPlatformId);
    const buyFee = await knowledgeLayerPlatformID.getBuyFee(carolPlatformId);
    const protocolFee = await knowledgeLayerEscrow.protocolFee();
    const totalPrice =
      coursePrice + (coursePrice * (originFee + buyFee + protocolFee)) / FEE_DIVIDER;
    await knowledgeLayerEscrow.connect(bob).createTransaction(bobId, courseId, carolPlatformId, {
      value: totalPrice,
    });

    // Dave can release the payment on behalf of Alice
    await knowledgeLayerEscrow.connect(dave).release(aliceId, transactionId);
  });

  it('Delegate can review course on behalf of user', async () => {
    await knowledgeLayerID.connect(bob).addDelegate(bobId, eve.address);

    const reviewDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMh';

    const tx = await knowledgeLayerReview.connect(eve).mint(bobId, courseId, reviewDataUri, 5);
    expect(tx).to.not.be.reverted;
  });

  it('Can remove a delegate', async () => {
    // Fails if the caller is not the owner of the profile
    const tx = knowledgeLayerID.connect(bob).removeDelegate(aliceId, dave.address);
    await expect(tx).to.be.revertedWith('Not the owner');

    await knowledgeLayerID.connect(alice).removeDelegate(aliceId, dave.address);
    const isDelegate = await knowledgeLayerID.isDelegate(alice.address, dave.address);
    expect(isDelegate).to.be.false;
  });

  it("Delegate can't update profile on behalf of user after removed", async () => {
    const dataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMi';
    const tx = knowledgeLayerID.connect(dave).updateProfileData(aliceId, dataUri);
    await expect(tx).to.be.revertedWith('Not owner or delegate');
  });
});
