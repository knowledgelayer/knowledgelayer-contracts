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

get-uri:
	npx hardhat run scripts/get-uri.ts --network $(NETWORK)

#-------------- SETUP ----------------#

setup: deploy mint-platform-id mint-id create-course buy-course

#-------------- SUBGRAPH ----------------#

update-graph-config: graph-copy-abis graph-copy-address

ifeq ($(OS),Windows_NT)
graph-copy-abis:
	Get-ChildItem -Path 'artifacts\contracts\' -Recurse -Include *.json | Where-Object { $_.FullName -notmatch '\\interfaces\\' -and $_.Name -notmatch '.*\.dbg\.json' } | Copy-Item -Destination '$(SUBGRAPH_FOLDER)\abis\' -Force
else
graph-copy-abis:
	find artifacts/contracts -path "artifacts/contracts/interfaces" -prune -o -name "*.json" ! -name "*.dbg.json" -exec cp {} $(SUBGRAPH_FOLDER)/abis/ \;
endif

graph-copy-address: 
	npx hardhat run scripts/utils/setSubgraphConfig.ts --network $(NETWORK)