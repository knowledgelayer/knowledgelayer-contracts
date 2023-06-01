#!make
include .env

# -------------- DEPLOYMENT -------------- #

deploy: 
	npx hardhat deploy --network $(NETWORK)

deploy-verify: 
	npx hardhat deploy --verify --network $(NETWORK)

#-------------- PLAYGROUND ----------------#

mint-platform-id:
	npx hardhat run scripts/playground/0-mintPlatformId.ts --network $(NETWORK)

mint-id:
	npx hardhat run scripts/playground/1-mintId.ts --network $(NETWORK)

create-course:
	npx hardhat run scripts/playground/2-createCourse.ts --network $(NETWORK)

buy-course:
	npx hardhat run scripts/playground/3-buyCourse.ts --network $(NETWORK)

release-payment:
	npx hardhat run scripts/playground/4-releasePayment.ts --network $(NETWORK)

create-review:
	npx hardhat run scripts/playground/5-createReview.ts --network $(NETWORK)

#-------------- SETUP ----------------#

setup: deploy mint-platform-id mint-id create-course buy-course release-payment create-review

#-------------- SUBGRAPH ----------------#

update-subgraph-config: update-subgraph-abis update-subgraph-addresses

ifeq ($(OS),Windows_NT)
update-subgraph-abis:
	Get-ChildItem -Path 'artifacts\contracts\' -Recurse -Include *.json | Where-Object { $_.FullName -notmatch '\\interfaces\\' -and $_.Name -notmatch '.*\.dbg\.json' } | Copy-Item -Destination '$(SUBGRAPH_FOLDER)\abis\' -Force
else
update-subgraph-abis:
	find artifacts/contracts -path "artifacts/contracts/interfaces" -prune -o -name "*.json" ! -name "*.dbg.json" -exec cp {} $(SUBGRAPH_FOLDER)/abis/ \;
endif

update-subgraph-addresses: 
	npx hardhat run scripts/utils/setSubgraphAddresses.ts --network $(NETWORK)