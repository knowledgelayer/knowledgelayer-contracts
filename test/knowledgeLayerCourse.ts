import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import {
  KnowledgeLayerCourse,
  KnowledgeLayerID,
  KnowledgeLayerPlatformID,
} from '../typechain-types';
import { deploy } from '../utils/deploy';
import { ETH_ADDRESS, MintStatus } from '../utils/constants';

describe('KnowledgeLayerCourse', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    aliceId: BigNumber,
    bob: SignerWithAddress,
    bobId: BigNumber,
    carol: SignerWithAddress,
    carolPlatformId: BigNumber,
    knowledgeLayerID: KnowledgeLayerID,
    knowledgeLayerPlatformID: KnowledgeLayerPlatformID,
    knowledgeLayerCourse: KnowledgeLayerCourse;

  const courseId = 1;
  const coursePrice = 100;
  const courseDisputePeriod = 60 * 60 * 24 * 7; // 7 days
  const courseDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMf';

  before(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();
    [knowledgeLayerID, knowledgeLayerPlatformID, knowledgeLayerCourse] = await deploy();

    // Add carol to whitelist and mint platform ID
    await knowledgeLayerPlatformID.connect(deployer).whitelistUser(carol.address);
    await knowledgeLayerPlatformID.connect(carol).mint('carol-platform');
    carolPlatformId = await knowledgeLayerPlatformID.connect(carol).ids(carol.address);

    // Disable whitelist and mint IDs
    await knowledgeLayerID.connect(deployer).updateMintStatus(MintStatus.PUBLIC);
    await knowledgeLayerID.connect(alice).mint(0, 'alice');
    await knowledgeLayerID.connect(bob).mint(0, 'bob__');

    aliceId = await knowledgeLayerID.connect(alice).ids(alice.address);
    bobId = await knowledgeLayerID.connect(bob).ids(bob.address);
  });

  describe('Create course', async () => {
    before(async () => {
      // Alice creates a course
      const tx = await knowledgeLayerCourse
        .connect(alice)
        .createCourse(
          aliceId,
          carolPlatformId,
          coursePrice,
          ETH_ADDRESS,
          courseDisputePeriod,
          courseDataUri,
        );
      await tx.wait();
    });

    it('Creates course with the correct data', async () => {
      const course = await knowledgeLayerCourse.courses(courseId);
      expect(course.ownerId).to.equal(aliceId);
      expect(course.platformId).to.equal(carolPlatformId);
      expect(course.price).to.equal(coursePrice);
      expect(course.dataUri).to.equal(courseDataUri);
    });
  });

  describe('Buy course', async () => {
    it("Fails if the caller doesn't have escrow role", async () => {
      const escrowRole = await knowledgeLayerCourse.ESCROW_ROLE();
      const tx = knowledgeLayerCourse.connect(bob).buyCourse(aliceId, courseId);
      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${bob.address.toLowerCase()} is missing role ${escrowRole.toLowerCase()}`,
      );
    });

    it('Succeeds if the caller has escrow role', async () => {
      const escrowRole = await knowledgeLayerCourse.ESCROW_ROLE();
      await knowledgeLayerCourse.connect(deployer).grantRole(escrowRole, bob.address);

      const tx = knowledgeLayerCourse.connect(bob).buyCourse(bobId, courseId);
      await expect(tx).to.not.be.reverted;
    });

    it('Mints a course token to Bob', async () => {
      const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
      expect(balance).to.equal(1);
    });
  });

  describe('Update course', async () => {
    const newPrice = 200;
    const newDisputePeriod = 60 * 60 * 24 * 14; // 14 days
    const newDataUri = 'QmVFZBWZ9anb3HCQtSDXprjKdZMxThbKHedj1on5N2HqMg';

    before(async () => {
      // Alice updates her course price
      const tx = await knowledgeLayerCourse
        .connect(alice)
        .updateCourse(aliceId, courseId, newPrice, ETH_ADDRESS, newDisputePeriod, newDataUri);
      await tx.wait();
    });

    it('Updates the course data', async () => {
      const course = await knowledgeLayerCourse.courses(courseId);
      expect(course.price).to.equal(newPrice);
      expect(course.disputePeriod).to.equal(newDisputePeriod);
      expect(course.dataUri).to.equal(newDataUri);
    });

    it('Only the course owner can update the course price', async () => {
      const tx = knowledgeLayerCourse
        .connect(bob)
        .updateCourse(bobId, courseId, newPrice, ETH_ADDRESS, newDisputePeriod, newDataUri);
      await expect(tx).to.be.revertedWith('Not the owner');
    });
  });

  describe('Token transfers', async () => {
    it("Tokens can't be transferred", async () => {
      const tx = knowledgeLayerCourse
        .connect(bob)
        .safeTransferFrom(bob.address, alice.address, courseId, 1, []);

      await expect(tx).to.be.revertedWith('Token transfer is not allowed');

      const tx2 = knowledgeLayerCourse
        .connect(bob)
        .safeBatchTransferFrom(bob.address, alice.address, [courseId], [1], []);

      await expect(tx2).to.be.revertedWith('Token transfer is not allowed');
    });
  });
});
