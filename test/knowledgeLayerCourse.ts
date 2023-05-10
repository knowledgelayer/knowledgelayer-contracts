import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import { KnowledgeLayerCourse } from '../typechain-types';

describe('KnowledgeLayerCourse', () => {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    knowledgeLayerCourse: KnowledgeLayerCourse;

  const courseId = 1;
  const coursePrice = ethers.utils.parseEther('0.00000001');
  const courseDataUri = 'QmcukPbbUN1YmxE5g8EnCjgkeUdV8LsKifnAo1t7iTSxdD';

  before(async () => {
    [deployer, alice, bob] = await ethers.getSigners();

    const KnowledgeLayerCourse = await ethers.getContractFactory('KnowledgeLayerCourse');
    knowledgeLayerCourse = await KnowledgeLayerCourse.deploy();
    await knowledgeLayerCourse.deployed();
  });

  describe('Create course', async () => {
    before(async () => {
      // Alice creates a course
      const tx = await knowledgeLayerCourse.connect(alice).createCourse(coursePrice, courseDataUri);
      await tx.wait();
    });

    it('Creates product with the correct data', async () => {
      const product = await knowledgeLayerCourse.courses(courseId);
      expect(product.seller).to.equal(alice.address);
      expect(product.price).to.equal(coursePrice);
      expect(product.dataUri).to.equal(courseDataUri);
    });
  });

  describe('Buy course', async () => {
    let tx: ContractTransaction;

    before(async () => {
      // Bob buys Alice's course
      tx = await knowledgeLayerCourse.connect(bob).buyCourse(courseId, {
        value: coursePrice,
      });
      await tx.wait();
    });

    it('Mints a course token to Bob', async () => {
      const balance = await knowledgeLayerCourse.balanceOf(bob.address, courseId);
      expect(balance).to.equal(1);
    });

    it("Sends Bob's money to Alice and fee to owner", async () => {
      const fee = coursePrice.div(100);
      await expect(tx).to.changeEtherBalances(
        [bob, alice, deployer],
        [-coursePrice, coursePrice.sub(fee), fee],
      );
    });
  });

  describe('Update product price', async () => {
    const newPrice = 200;
    const newDataUri = 'QmcukPbbUN1YmxE5g8EnCjgkeUdV8LsKifnAo1t7iTSxdE';

    before(async () => {
      // Alice updates her product price
      const tx = await knowledgeLayerCourse
        .connect(alice)
        .updateCourse(courseId, newPrice, newDataUri);
      await tx.wait();
    });

    it('Updates the product', async () => {
      const course = await knowledgeLayerCourse.courses(courseId);
      expect(course.price).to.equal(newPrice);
      expect(course.dataUri).to.equal(newDataUri);
    });

    it('Only the owner can update the product price', async () => {
      const tx = knowledgeLayerCourse.connect(bob).updateCourse(courseId, newPrice, newDataUri);
      expect(tx).to.be.revertedWith('Only seller can update price');
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
