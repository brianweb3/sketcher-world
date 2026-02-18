import * as THREE from 'three';
import * as CANNON from 'cannon';
import Swal from 'sweetalert2';
import * as $ from 'jquery';

import { CameraOperator } from '../core/CameraOperator';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { FXAAShader  } from 'three/examples/jsm/shaders/FXAAShader';

import { Detector } from '../../lib/utils/Detector';
import { Stats } from '../../lib/utils/Stats';
import * as GUI from '../../lib/utils/dat.gui';
import { CannonDebugRenderer } from '../../lib/cannon/CannonDebugRenderer';
import * as _ from 'lodash';

import { InputManager } from '../core/InputManager';
import * as Utils from '../core/FunctionLibrary';
import { LoadingManager } from '../core/LoadingManager';
import { InfoStack } from '../core/InfoStack';
import { UIManager } from '../core/UIManager';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
import { Path } from './Path';
import { CollisionGroups } from '../enums/CollisionGroups';
import { BoxCollider } from '../physics/colliders/BoxCollider';
import { TrimeshCollider } from '../physics/colliders/TrimeshCollider';
import { Vehicle } from '../vehicles/Vehicle';
import { Scenario } from './Scenario';
import { Sky } from './Sky';
import { Ocean } from './Ocean';

export class World
{
	public renderer: THREE.WebGLRenderer;
	public camera: THREE.PerspectiveCamera;
	public composer: any;
	public stats: Stats;
	public graphicsWorld: THREE.Scene;
	public sky: Sky;
	public physicsWorld: CANNON.World;
	public parallelPairs: any[];
	public physicsFrameRate: number;
	public physicsFrameTime: number;
	public physicsMaxPrediction: number;
	public clock: THREE.Clock;
	public renderDelta: number;
	public logicDelta: number;
	public requestDelta: number;
	public sinceLastFrame: number;
	public justRendered: boolean;
	public params: any;
	public inputManager: InputManager;
	public cameraOperator: CameraOperator;
	public timeScaleTarget: number = 1;
	public console: InfoStack;
	public cannonDebugRenderer: CannonDebugRenderer;
	public scenarios: Scenario[] = [];
	public characters: Character[] = [];
	public vehicles: Vehicle[] = [];
	public paths: Path[] = [];
	public scenarioGUIFolder: any;
	public updatables: IUpdatable[] = [];

	private lastScenarioID: string;
	private musicEnabled: boolean = true;
	private musicInitialized: boolean = false;
	private ambientMusic: HTMLAudioElement;
	private readonly musicTrackPath: string = 'build/assets/golden-dust.mp3';
	private readonly musicVolume: number = 0.16;
	private readonly coinPickupSoundPath: string = 'build/assets/coin-pickup.mp3';
	private coinPickupSound: HTMLAudioElement;
	private coinsCounterEl: HTMLElement;
	private impactCounterEl: HTMLElement;
	private buybackCounterEl: HTMLElement;
	private walletAddressEl: HTMLAnchorElement;
	private walletBalanceEl: HTMLElement;
	private buybackListEl: HTMLElement;
	private buybackHistoryLoading: boolean = false;
	private coinTemplate: THREE.Object3D;
	private activeCoins: THREE.Object3D[] = [];
	private pendingCoinSpawn: boolean = false;
	private coinsCollected: number = 0;
	private coinsSpawned: number = 0;
	private economyImpactPoints: number = 0;
	private walletBalanceSol: number = 0;
	private plannedBuybackSol: number = 0;
	private readonly buybackWalletAddress: string = '62RdwFeNALkAMy9eKxPACDXToTYBfbPfDfShQaHfK6Xi';
	private readonly heliusRpcUrl: string = 'https://mainnet.helius-rpc.com/?api-key=27b24668-8830-44fc-be8b-ed1046c1631c';
	private readonly totalCoinsToSpawn: number = 160;
	private readonly coinCollectDistance: number = 1.65;

	constructor(worldScenePath?: any)
	{
		const scope = this;

		// WebGL not supported
		if (!Detector.webgl)
		{
			Swal.fire({
				icon: 'warning',
				title: 'WebGL compatibility',
				text: 'This browser doesn\'t seem to have the required WebGL capabilities. The application may not work correctly.',
				footer: '<a href="https://get.webgl.org/" target="_blank">Click here for more information</a>',
				showConfirmButton: false,
				buttonsStyling: false
			});
		}

		// Renderer
		this.renderer = new THREE.WebGLRenderer();
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		this.generateHTML();

		// Auto window resize
		function onWindowResize(): void
		{
			scope.camera.aspect = window.innerWidth / window.innerHeight;
			scope.camera.updateProjectionMatrix();
			scope.renderer.setSize(window.innerWidth, window.innerHeight);
			fxaaPass.uniforms['resolution'].value.set(1 / (window.innerWidth * pixelRatio), 1 / (window.innerHeight * pixelRatio));
			scope.composer.setSize(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio);
		}
		window.addEventListener('resize', onWindowResize, false);

		// Three.js scene
		this.graphicsWorld = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1010);

		// Passes
		let renderPass = new RenderPass( this.graphicsWorld, this.camera );
		let fxaaPass = new ShaderPass( FXAAShader );

		// FXAA
		let pixelRatio = this.renderer.getPixelRatio();
		fxaaPass.material['uniforms'].resolution.value.x = 1 / ( window.innerWidth * pixelRatio );
		fxaaPass.material['uniforms'].resolution.value.y = 1 / ( window.innerHeight * pixelRatio );

		// Composer
		this.composer = new EffectComposer( this.renderer );
		this.composer.addPass( renderPass );
		this.composer.addPass( fxaaPass );

		// Physics
		this.physicsWorld = new CANNON.World();
		this.physicsWorld.gravity.set(0, -9.81, 0);
		this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
		this.physicsWorld.solver.iterations = 10;
		this.physicsWorld.allowSleep = true;

		this.parallelPairs = [];
		this.physicsFrameRate = 60;
		this.physicsFrameTime = 1 / this.physicsFrameRate;
		this.physicsMaxPrediction = this.physicsFrameRate;

		// RenderLoop
		this.clock = new THREE.Clock();
		this.renderDelta = 0;
		this.logicDelta = 0;
		this.sinceLastFrame = 0;
		this.justRendered = false;

		// Stats (FPS, Frame time, Memory)
		this.stats = Stats();
		// Create right panel GUI
		this.createParamsGUI(scope);

		// Initialization
		this.inputManager = new InputManager(this, this.renderer.domElement);
		this.cameraOperator = new CameraOperator(this, this.camera, this.params.Mouse_Sensitivity);
		this.sky = new Sky(this);
		
		// Load scene if path is supplied
		if (worldScenePath !== undefined)
		{
			let loadingManager = new LoadingManager(this);
			loadingManager.onFinishedCallback = () =>
			{
				this.update(1, 1);
				this.setTimeScale(1);

				Swal.fire({
					title: 'Welcome to Sketcher World',
					html: `You are now inside a living prototype.<br>
Move freely, test the physics, drive vehicles, fly machines, and reshape the space around you.<br>
Everything here is unfinished by design.<br>
Every action leaves a trace.<br>
Every scenario is a draft waiting to be explored.<br>
Launch experiments from the right panel.<br>
And become part of the sketch.`,
					customClass: {
						title: 'sketcher-welcome-title',
					},
					confirmButtonText: 'Okay',
					buttonsStyling: false,
					onOpen: () => {
						const actions = document.querySelector('.swal2-actions');
						if (actions)
						{
							const xButton = document.createElement('a');
							xButton.className = 'sketcher-link-button sketcher-x-button';
							xButton.href = 'https://x.com/thesketcherwrld';
							xButton.target = '_blank';
							xButton.rel = 'noopener noreferrer';
							xButton.title = 'Sketcher World on X';
							xButton.innerHTML = '<img src="build/assets/sketcher-x-logo.svg" alt="Sketcher World X">';
							actions.appendChild(xButton);

							const pumpButton = document.createElement('a');
							pumpButton.className = 'sketcher-link-button sketcher-pump-button';
							pumpButton.href = 'https://pump.fun/coin/HGKzAj6tBfWoYHuqh2Yugg7tpdjj7iU38sV372Q5pump';
							pumpButton.target = '_blank';
							pumpButton.rel = 'noopener noreferrer';
							pumpButton.title = 'Sketcher World on pump.fun';
							pumpButton.innerHTML = '<img src="build/assets/sketcher-pump-logo.svg" alt="Sketcher World pump.fun">';
							actions.appendChild(pumpButton);
						}
					},
					onClose: () => {
						UIManager.setUserInterfaceVisible(true);
					}
				});
			};
			loadingManager.loadGLTF(worldScenePath, (gltf) =>
				{
					this.loadScene(loadingManager, gltf);
				}
			);
		}
		else
		{
			UIManager.setUserInterfaceVisible(true);
			UIManager.setLoadingScreenVisible(false);
			Swal.fire({
				icon: 'success',
				title: 'Hello world!',
				text: 'Empty Sketchbook world was succesfully initialized. Enjoy the blueness of the sky.',
				buttonsStyling: false
			});
		}

		this.render(this);
	}

	// Update
	// Handles all logic updates.
	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.updatePhysics(timeStep);
		this.updateCoins(unscaledTimeStep);

		// Update registred objects
		this.updatables.forEach((entity) => {
			entity.update(timeStep, unscaledTimeStep);
		});

		// Lerp time scale
		this.params.Time_Scale = THREE.MathUtils.lerp(this.params.Time_Scale, this.timeScaleTarget, 0.2);

		// Physics debug
		if (this.params.Debug_Physics) this.cannonDebugRenderer.update();
	}

	public updatePhysics(timeStep: number): void
	{
		// Step the physics world
		this.physicsWorld.step(this.physicsFrameTime, timeStep);

		this.characters.forEach((char) => {
			if (this.isOutOfBounds(char.characterCapsule.body.position))
			{
				this.outOfBoundsRespawn(char.characterCapsule.body);
			}
		});

		this.vehicles.forEach((vehicle) => {
			if (this.isOutOfBounds(vehicle.rayCastVehicle.chassisBody.position))
			{
				let worldPos = new THREE.Vector3();
				vehicle.spawnPoint.getWorldPosition(worldPos);
				worldPos.y += 1;
				this.outOfBoundsRespawn(vehicle.rayCastVehicle.chassisBody, Utils.cannonVector(worldPos));
			}
		});
	}

	public isOutOfBounds(position: CANNON.Vec3): boolean
	{
		let inside = position.x > -211.882 && position.x < 211.882 &&
					position.z > -169.098 && position.z < 153.232 &&
					position.y > 0.107;
		let belowSeaLevel = position.y < 14.989;

		return !inside && belowSeaLevel;
	}

	public outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void
	{
		let newPos = position || new CANNON.Vec3(0, 16, 0);
		let newQuat = new CANNON.Quaternion(0, 0, 0, 1);

		body.position.copy(newPos);
		body.interpolatedPosition.copy(newPos);
		body.quaternion.copy(newQuat);
		body.interpolatedQuaternion.copy(newQuat);
		body.velocity.setZero();
		body.angularVelocity.setZero();
	}

	/**
	 * Rendering loop.
	 * Implements fps limiter and frame-skipping
	 * Calls world's "update" function before rendering.
	 * @param {World} world 
	 */
	public render(world: World): void
	{
		this.requestDelta = this.clock.getDelta();

		requestAnimationFrame(() =>
		{
			world.render(world);
		});

		// Getting timeStep
		let unscaledTimeStep = (this.requestDelta + this.renderDelta + this.logicDelta) ;
		let timeStep = unscaledTimeStep * this.params.Time_Scale;
		timeStep = Math.min(timeStep, 1 / 30);    // min 30 fps

		// Logic
		world.update(timeStep, unscaledTimeStep);

		// Measuring logic time
		this.logicDelta = this.clock.getDelta();

		// Frame limiting
		let interval = 1 / 60;
		this.sinceLastFrame += this.requestDelta + this.renderDelta + this.logicDelta;
		this.sinceLastFrame %= interval;

		// Stats end
		this.stats.end();
		this.stats.begin();

		// Actual rendering with a FXAA ON/OFF switch
		if (this.params.FXAA) this.composer.render();
		else this.renderer.render(this.graphicsWorld, this.camera);

		// Measuring render time
		this.renderDelta = this.clock.getDelta();
	}

	public setTimeScale(value: number): void
	{
		this.params.Time_Scale = value;
		this.timeScaleTarget = value;
	}

	public add(worldEntity: IWorldEntity): void
	{
		worldEntity.addToWorld(this);
		this.registerUpdatable(worldEntity);
	}

	public registerUpdatable(registree: IUpdatable): void
	{
		this.updatables.push(registree);
		this.updatables.sort((a, b) => (a.updateOrder > b.updateOrder) ? 1 : -1);
	}

	public remove(worldEntity: IWorldEntity): void
	{
		worldEntity.removeFromWorld(this);
		this.unregisterUpdatable(worldEntity);
	}

	public unregisterUpdatable(registree: IUpdatable): void
	{
		_.pull(this.updatables, registree);
	}

	public loadScene(loadingManager: LoadingManager, gltf: any): void
	{
		loadingManager.loadGLTF('build/assets/coin.glb', (coinModel) =>
		{
			this.coinTemplate = coinModel.scene;
			this.prepareCoinTemplate(this.coinTemplate);
			this.trySpawnCoins();
		});

		gltf.scene.traverse((child) => {
			if (child.hasOwnProperty('userData'))
			{
				if (child.type === 'Mesh')
				{
					Utils.setupMeshProperties(child);
					this.sky.csm.setupMaterial(child.material);

					if (child.material.name === 'ocean')
					{
						this.registerUpdatable(new Ocean(child, this));
					}
				}

				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'physics')
					{
						if (child.userData.hasOwnProperty('type')) 
						{
							// Convex doesn't work! Stick to boxes!
							if (child.userData.type === 'box')
							{
								let phys = new BoxCollider({size: new THREE.Vector3(child.scale.x, child.scale.y, child.scale.z)});
								phys.body.position.copy(Utils.cannonVector(child.position));
								phys.body.quaternion.copy(Utils.cannonQuat(child.quaternion));
								phys.body.computeAABB();

								phys.body.shapes.forEach((shape) => {
									shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
								});

								this.physicsWorld.addBody(phys.body);
							}
							else if (child.userData.type === 'trimesh')
							{
								let phys = new TrimeshCollider(child, {});
								this.physicsWorld.addBody(phys.body);
							}

							child.visible = false;
						}
					}

					if (child.userData.data === 'path')
					{
						this.paths.push(new Path(child));
					}

					if (child.userData.data === 'spawn')
					{
						child.visible = false;
					}

					if (child.userData.data === 'scenario')
					{
						this.scenarios.push(new Scenario(child, this));
					}
				}
			}
		});

		this.graphicsWorld.add(gltf.scene);

		// Launch default scenario
		let defaultScenarioID: string;
		for (const scenario of this.scenarios) {
			if (scenario.default) {
				defaultScenarioID = scenario.id;
				break;
			}
		}
		if (defaultScenarioID !== undefined) this.launchScenario(defaultScenarioID, loadingManager);
	}
	
	public launchScenario(scenarioID: string, loadingManager?: LoadingManager): void
	{
		this.lastScenarioID = scenarioID;

		this.clearEntities();
		this.clearCoinsFromWorld();
		this.resetCoinEconomy();
		this.pendingCoinSpawn = true;

		// Launch default scenario
		if (!loadingManager) loadingManager = new LoadingManager(this);
		for (const scenario of this.scenarios) {
			if (scenario.id === scenarioID || scenario.spawnAlways) {
				scenario.launch(loadingManager, this);
			}
		}

		this.trySpawnCoins();
	}

	public restartScenario(): void
	{
		if (this.lastScenarioID !== undefined)
		{
			document.exitPointerLock();
			this.launchScenario(this.lastScenarioID);
		}
		else
		{
			console.warn('Can\'t restart scenario. Last scenarioID is undefined.');
		}
	}

	public clearEntities(): void
	{
		for (let i = 0; i < this.characters.length; i++) {
			this.remove(this.characters[i]);
			i--;
		}

		for (let i = 0; i < this.vehicles.length; i++) {
			this.remove(this.vehicles[i]);
			i--;
		}
	}

	public scrollTheTimeScale(scrollAmount: number): void
	{
		// Changing time scale with scroll wheel
		const timeScaleBottomLimit = 0.003;
		const timeScaleChangeSpeed = 1.3;
	
		if (scrollAmount > 0)
		{
			this.timeScaleTarget /= timeScaleChangeSpeed;
			if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = 0;
		}
		else
		{
			this.timeScaleTarget *= timeScaleChangeSpeed;
			if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = timeScaleBottomLimit;
			this.timeScaleTarget = Math.min(this.timeScaleTarget, 1);
		}
	}

	public updateControls(controls: any): void
	{
		let html = '';
		html += '<h2 class="controls-title">Controls:</h2>';

		controls.forEach((row) =>
		{
			html += '<div class="ctrl-row">';
			row.keys.forEach((key) => {
				if (key === '+' || key === 'and' || key === 'or' || key === '&') html += '&nbsp;' + key + '&nbsp;';
				else html += '<span class="ctrl-key">' + key + '</span>';
			});

			html += '<span class="ctrl-desc">' + row.desc + '</span></div>';
		});

		document.getElementById('controls').innerHTML = html;
	}

	private generateHTML(): void
	{
		// Fonts
		$('head').append('<link href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap" rel="stylesheet">');
		$('head').append('<link href="https://fonts.googleapis.com/css2?family=Solway:wght@400;500;700&display=swap" rel="stylesheet">');
		$('head').append('<link href="https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap" rel="stylesheet">');

		// Loader
		$(`	<div id="loading-screen">
				<div id="loading-screen-background"></div>
				<h1 id="main-title" class="sb-font">PumpFun Sketcher</h1>
				<div class="cubeWrap">
					<div class="cube">
						<div class="faces1"></div>
						<div class="faces2"></div>     
					</div> 
				</div> 
				<div id="loading-text">Loading...</div>
			</div>
		`).appendTo('body');

		// UI
		$(`	<div id="ui-container" style="display: none;">
				<div class="top-left-hud">
					<div class="top-left-actions">
						<a class="hud-link hud-link-pump" href="https://pump.fun/coin/HGKzAj6tBfWoYHuqh2Yugg7tpdjj7iU38sV372Q5pump" target="_blank" rel="noopener noreferrer" title="PumpFun">
							<img src="build/assets/sketcher-pump-logo.svg" alt="PumpFun">
						</a>
						<a class="hud-link hud-link-x" href="https://x.com/thesketcherwrld" target="_blank" rel="noopener noreferrer" title="X">
							<img src="build/assets/sketcher-x-logo.svg" alt="X">
						</a>
						<button id="copy-ca-button" class="hud-copy-ca" type="button">COPY CA</button>
						<button id="music-toggle-button" class="hud-copy-ca hud-music-toggle" type="button">MUSIC ON</button>
					</div>
					<div class="token-stats-panel">
						<h3 class="token-stats-title">Impact Engine</h3>
						<div class="token-stats-row">
							<span>Coins</span>
							<strong id="coins-counter">0 / 0</strong>
						</div>
						<div class="token-stats-row">
							<span>Total On Map</span>
							<strong id="total-coins-counter">160</strong>
						</div>
						<div class="token-stats-row">
							<span>Impact Points</span>
							<strong id="impact-counter">0</strong>
						</div>
						<div class="token-stats-row">
							<span>Wallet</span>
							<a id="wallet-address" href="#" target="_blank" rel="noopener noreferrer">-</a>
						</div>
						<div class="token-stats-row">
							<span>Balance (SOL)</span>
							<strong id="wallet-balance">0.0000</strong>
						</div>
						<div class="token-stats-row">
							<span>Planned Buyback</span>
							<strong id="buyback-counter">0 SOL</strong>
						</div>
						<p class="token-stats-note">Collect 40 coins to trigger 1 SOL buyback from the wallet. Total on map: 160.</p>
					</div>
					<div class="buyback-history-panel">
						<h3 class="token-stats-title">Buybacks</h3>
						<div id="buyback-list" class="buyback-list">
							<div class="buyback-empty">Loading buybacks...</div>
						</div>
					</div>
				</div>
				<div class="left-panel">
					<div id="controls" class="panel-segment flex-bottom"></div>
				</div>
				<div id="coin-toast-container"></div>
			</div>
		`).appendTo('body');

		const contractAddress = 'HGKzAj6tBfWoYHuqh2Yugg7tpdjj7iU38sV372Q5pump';
		const copyButton = document.getElementById('copy-ca-button') as HTMLButtonElement;

		if (copyButton)
		{
			const showCopiedState = () =>
			{
				const originalText = copyButton.textContent || 'COPY CA';
				copyButton.textContent = 'COPIED';
				setTimeout(() => {
					copyButton.textContent = originalText;
				}, 1200);
			};

			const fallbackCopy = () =>
			{
				const textArea = document.createElement('textarea');
				textArea.value = contractAddress;
				textArea.style.position = 'fixed';
				textArea.style.opacity = '0';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				document.execCommand('copy');
				document.body.removeChild(textArea);
				showCopiedState();
			};

			copyButton.addEventListener('click', () =>
			{
				const clipboard = (navigator as any).clipboard;

				if (clipboard && window.isSecureContext)
				{
					clipboard.writeText(contractAddress)
						.then(() => showCopiedState())
						.catch(() => fallbackCopy());
				}
				else
				{
					fallbackCopy();
				}
			});
		}

		this.coinsCounterEl = document.getElementById('coins-counter');
		this.impactCounterEl = document.getElementById('impact-counter');
		this.buybackCounterEl = document.getElementById('buyback-counter');
		this.walletAddressEl = document.getElementById('wallet-address') as HTMLAnchorElement;
		this.walletBalanceEl = document.getElementById('wallet-balance');
		this.buybackListEl = document.getElementById('buyback-list');
		this.refreshEconomyPanel();
		this.initializeWalletTracking();
		this.initializeCoinPickupSound();
		this.initializeMusicToggle();
		this.syncImpactPanelWidth();
		window.addEventListener('resize', () => this.syncImpactPanelWidth());

		// Canvas
		document.body.appendChild(this.renderer.domElement);
		this.renderer.domElement.id = 'canvas';
	}

	private initializeMusicToggle(): void
	{
		const musicButton = document.getElementById('music-toggle-button') as HTMLButtonElement;
		if (!musicButton) return;

		const refreshMusicButton = () =>
		{
			musicButton.textContent = this.musicEnabled ? 'MUSIC ON' : 'MUSIC OFF';
			musicButton.classList.toggle('is-off', !this.musicEnabled);
		};

		const unlockAndStart = () =>
		{
			if (this.musicEnabled) this.startAmbientMusic();
		};

		refreshMusicButton();

		window.addEventListener('pointerdown', unlockAndStart, { once: true });
		window.addEventListener('keydown', unlockAndStart, { once: true });

		musicButton.addEventListener('click', () =>
		{
			this.musicEnabled = !this.musicEnabled;
			if (this.musicEnabled)
			{
				this.startAmbientMusic();
			}
			else
			{
				if (this.ambientMusic)
				{
					this.setMusicVolume(0);
					this.ambientMusic.pause();
				}
			}
			refreshMusicButton();
		});
	}

	private startAmbientMusic(): void
	{
		if (!this.musicInitialized)
		{
			this.ambientMusic = new Audio(this.musicTrackPath);
			this.ambientMusic.preload = 'auto';
			this.ambientMusic.loop = true;
			this.ambientMusic.volume = 0;

			// Fallback for environments where loop may be ignored.
			this.ambientMusic.addEventListener('ended', () =>
			{
				if (this.musicEnabled)
				{
					this.ambientMusic.currentTime = 0;
					this.ambientMusic.play().catch(() => undefined);
				}
			});

			this.musicInitialized = true;
		}

		if (!this.musicEnabled) return;

		this.setMusicVolume(this.musicVolume);
		this.ambientMusic.play().catch(() => undefined);
	}

	private initializeCoinPickupSound(): void
	{
		this.coinPickupSound = new Audio(this.coinPickupSoundPath);
		this.coinPickupSound.preload = 'auto';
		this.coinPickupSound.volume = 0.7;
	}

	private playCoinPickupSound(): void
	{
		const baseSound = this.coinPickupSound;
		if (!baseSound) return;

		const sfx = baseSound.cloneNode(true) as HTMLAudioElement;
		sfx.volume = baseSound.volume;
		sfx.currentTime = 0;

		sfx.play().catch(() => undefined);
		window.setTimeout(() =>
		{
			sfx.pause();
			sfx.currentTime = 0;
		}, 1000);
	}

	private setMusicVolume(target: number): void
	{
		if (!this.ambientMusic) return;
		this.ambientMusic.volume = THREE.MathUtils.clamp(target, 0, 1);
	}

	private prepareCoinTemplate(template: THREE.Object3D): void
	{
		template.traverse((child: any) =>
		{
			if (child.type === 'Mesh')
			{
				// Keep source GLB look exactly as provided.
				child.castShadow = true;
				child.receiveShadow = true;
			}
		});

		const bounds = new THREE.Box3().setFromObject(template);
		const size = new THREE.Vector3();
		bounds.getSize(size);
		const maxSide = Math.max(size.x, size.y, size.z, 0.001);
		template.scale.setScalar(0.9 / maxSide);
	}

	private clearCoinsFromWorld(): void
	{
		this.activeCoins.forEach((coin) => {
			this.graphicsWorld.remove(coin);
		});
		this.activeCoins = [];
		this.coinsSpawned = 0;
	}

	private resetCoinEconomy(): void
	{
		this.coinsCollected = 0;
		this.economyImpactPoints = 0;
		this.plannedBuybackSol = 0;
		this.refreshEconomyPanel();
	}

	private trySpawnCoins(): void
	{
		if (!this.pendingCoinSpawn) return;
		if (!this.coinTemplate) return;

		this.pendingCoinSpawn = false;
		this.spawnCoinsAcrossMap();
	}

	private spawnCoinsAcrossMap(): void
	{
		if (!this.coinTemplate || this.activeCoins.length > 0) return;

		const minX = -205;
		const maxX = 205;
		const minZ = -160;
		const maxZ = 145;
		const maxAttempts = this.totalCoinsToSpawn * 60;

		let spawned = 0;
		for (let attempt = 0; attempt < maxAttempts && spawned < this.totalCoinsToSpawn; attempt++)
		{
			const x = THREE.MathUtils.randFloat(minX, maxX);
			const z = THREE.MathUtils.randFloat(minZ, maxZ);
			const groundY = this.getGroundHeightAt(x, z);

			if (!Number.isFinite(groundY)) continue;
			if (groundY < 0.15 || groundY > 120) continue;

			const coin = this.coinTemplate.clone(true);
			const phase = Math.random() * Math.PI * 2;
			const baseY = groundY + 0.8;

			coin.position.set(x, baseY, z);
			coin.userData.coinBaseY = baseY;
			coin.userData.coinFloatPhase = phase;
			coin.userData.coinSpin = 1.5 + Math.random() * 1.2;

			this.graphicsWorld.add(coin);
			this.activeCoins.push(coin);
			spawned++;
		}

		this.coinsSpawned = spawned;
		this.refreshEconomyPanel();
	}

	private getGroundHeightAt(x: number, z: number): number
	{
		const from = new CANNON.Vec3(x, 260, z);
		const to = new CANNON.Vec3(x, -30, z);
		const rayResult = new CANNON.RaycastResult();
		const hit = this.physicsWorld.raycastClosest(from, to, { skipBackfaces: true }, rayResult);

		if (!hit) return NaN;
		return rayResult.hitPointWorld.y;
	}

	private updateCoins(unscaledTimeStep: number): void
	{
		this.trySpawnCoins();
		if (this.activeCoins.length === 0 || this.characters.length === 0) return;

		const collectDistanceSquared = this.coinCollectDistance * this.coinCollectDistance;
		const elapsed = this.clock.elapsedTime;
		const characterPositions: THREE.Vector3[] = [];

		this.characters.forEach((character) =>
		{
			characterPositions.push(Utils.threeVector(character.characterCapsule.body.position));
		});

		for (let i = this.activeCoins.length - 1; i >= 0; i--)
		{
			const coin = this.activeCoins[i];
			const baseY = coin.userData.coinBaseY || coin.position.y;
			const phase = coin.userData.coinFloatPhase || 0;
			const spin = coin.userData.coinSpin || 2;

			coin.rotation.y += unscaledTimeStep * spin;
			coin.position.y = baseY + Math.sin((elapsed * 2.2) + phase) * 0.13;

			let isCollected = false;
			for (let j = 0; j < characterPositions.length; j++)
			{
				if (coin.position.distanceToSquared(characterPositions[j]) <= collectDistanceSquared)
				{
					isCollected = true;
					break;
				}
			}

			if (isCollected)
			{
				this.collectCoin(i);
			}
		}
	}

	private collectCoin(index: number): void
	{
		const coin = this.activeCoins[index];
		this.graphicsWorld.remove(coin);
		this.activeCoins.splice(index, 1);
		this.playCoinPickupSound();

		this.coinsCollected++;
		this.economyImpactPoints = this.coinsCollected * 125;
		this.plannedBuybackSol = Math.floor(this.coinsCollected / 40);
		this.showCoinToast();
		this.refreshEconomyPanel();
	}

	private showCoinToast(): void
	{
		const container = document.getElementById('coin-toast-container');
		if (!container) return;

		const remainingForBuyback = (40 - (this.coinsCollected % 40)) % 40;
		const secondaryText = remainingForBuyback === 0
			? 'Buyback ready: +1 SOL'
			: `${remainingForBuyback} coins left for buyback`;

		const toast = document.createElement('div');
		toast.className = 'coin-toast';
		toast.innerHTML = `<strong>+1 coin collected</strong><span>${secondaryText}</span>`;

		container.appendChild(toast);
		window.setTimeout(() => toast.classList.add('coin-toast-hide'), 1700);
		window.setTimeout(() => {
			if (toast.parentElement === container) container.removeChild(toast);
		}, 2300);
	}

	private refreshEconomyPanel(): void
	{
		if (this.coinsCounterEl)
		{
			this.coinsCounterEl.textContent = `${this.coinsCollected.toLocaleString('en-US')} / ${this.coinsSpawned.toLocaleString('en-US')}`;
		}

		if (this.impactCounterEl)
		{
			this.impactCounterEl.textContent = this.economyImpactPoints.toLocaleString('en-US');
		}

		if (this.buybackCounterEl)
		{
			this.buybackCounterEl.textContent = `${this.plannedBuybackSol.toLocaleString('en-US')} SOL`;
		}

		if (this.walletAddressEl)
		{
			this.walletAddressEl.textContent = this.buybackWalletAddress;
			this.walletAddressEl.href = `https://solscan.io/account/${this.buybackWalletAddress}`;
		}

		if (this.walletBalanceEl)
		{
			this.walletBalanceEl.textContent = this.walletBalanceSol.toLocaleString('en-US', {
				minimumFractionDigits: 4,
				maximumFractionDigits: 4
			});
		}
	}

	private initializeWalletTracking(): void
	{
		this.refreshEconomyPanel();
		this.refreshWalletBalance();
		this.refreshBuybackHistory();
		window.setInterval(() => this.refreshWalletBalance(), 20000);
		window.setInterval(() => this.refreshBuybackHistory(), 30000);
	}

	private refreshWalletBalance(): void
	{
		const payload = {
			jsonrpc: '2.0',
			id: 1,
			method: 'getBalance',
			params: [this.buybackWalletAddress]
		};

		fetch(this.heliusRpcUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		})
		.then((response) => response.json())
		.then((result) =>
		{
			const lamports = result && result.result ? result.result.value : undefined;
			if (typeof lamports === 'number')
			{
				this.walletBalanceSol = lamports / 1000000000;
				this.refreshEconomyPanel();
			}
		})
		.catch(() => undefined);
	}

	private refreshBuybackHistory(): void
	{
		if (this.buybackHistoryLoading || !this.buybackListEl) return;
		this.buybackHistoryLoading = true;

		const signaturesPayload = {
			jsonrpc: '2.0',
			id: 2,
			method: 'getSignaturesForAddress',
			params: [this.buybackWalletAddress, { limit: 16 }]
		};

		fetch(this.heliusRpcUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(signaturesPayload)
		})
		.then((response) => response.json())
		.then((result) =>
		{
			const signatures = (result && result.result) ? result.result : [];
			const txSignatures = signatures
				.map((entry) => entry && entry.signature ? entry.signature : '')
				.filter((signature) => signature.length > 0)
				.slice(0, 12);

			return Promise.all(txSignatures.map((signature) =>
			{
				const txPayload = {
					jsonrpc: '2.0',
					id: 3,
					method: 'getTransaction',
					params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]
				};

				return fetch(this.heliusRpcUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(txPayload)
				})
				.then((response) => response.json())
				.then((txResult) =>
				{
					const tx = txResult ? txResult.result : undefined;
					if (!tx || !tx.meta || !tx.transaction || !tx.transaction.message) return undefined;

					const accountKeys = tx.transaction.message.accountKeys || [];
					const walletIndex = accountKeys.findIndex((key) =>
					{
						if (typeof key === 'string') return key === this.buybackWalletAddress;
						return key && key.pubkey === this.buybackWalletAddress;
					});

					if (walletIndex < 0) return undefined;

					const preBalances = tx.meta.preBalances || [];
					const postBalances = tx.meta.postBalances || [];
					const preLamports = typeof preBalances[walletIndex] === 'number' ? preBalances[walletIndex] : 0;
					const postLamports = typeof postBalances[walletIndex] === 'number' ? postBalances[walletIndex] : 0;
					const outgoingLamports = preLamports - postLamports;
					if (outgoingLamports <= 0) return undefined;

					return {
						signature,
						amountSol: outgoingLamports / 1000000000
					};
				})
				.catch(() => undefined);
			}));
		})
		.then((items: any[]) =>
		{
			if (!this.buybackListEl) return;

			const buybacks = (items || [])
				.filter((item) => !!item && item.amountSol > 0.0005)
				.slice(0, 6);

			if (buybacks.length === 0)
			{
				this.buybackListEl.innerHTML = '<div class="buyback-empty">No buybacks yet.</div>';
				return;
			}

			this.buybackListEl.innerHTML = buybacks.map((buyback) =>
			{
				const txShort = `${buyback.signature.slice(0, 6)}...${buyback.signature.slice(-6)}`;
				const amount = buyback.amountSol.toFixed(4);
				return `<a class="buyback-item" href="https://solscan.io/tx/${buyback.signature}" target="_blank" rel="noopener noreferrer"><span class="buyback-tx">TX ${txShort}</span><strong>${amount} SOL</strong></a>`;
			}).join('');
		})
		.catch(() =>
		{
			if (this.buybackListEl) this.buybackListEl.innerHTML = '<div class="buyback-empty">Unable to load buybacks.</div>';
		})
		.finally(() =>
		{
			this.buybackHistoryLoading = false;
		});
	}

	private syncImpactPanelWidth(): void
	{
		const actionsRow = document.querySelector('.top-left-actions') as HTMLElement;
		const impactPanel = document.querySelector('.token-stats-panel') as HTMLElement;
		const buybackPanel = document.querySelector('.buyback-history-panel') as HTMLElement;
		if (!actionsRow || !impactPanel) return;

		const width = Math.ceil((actionsRow.getBoundingClientRect().width + 90) * 3);
		impactPanel.style.width = `${width}px`;
		if (buybackPanel) buybackPanel.style.width = `${width}px`;
	}

	private createParamsGUI(scope: World): void
	{
		this.params = {
			Pointer_Lock: true,
			Mouse_Sensitivity: 0.3,
			Time_Scale: 1,
			Shadows: true,
			FXAA: true,
			Debug_Physics: false,
			Debug_FPS: false,
			Sun_Elevation: 50,
			Sun_Rotation: 145,
		};

		const gui = new GUI.GUI();

		// Scenario
		this.scenarioGUIFolder = gui.addFolder('Scenarios');

		// World
		let worldFolder = gui.addFolder('World');
		worldFolder.add(this.params, 'Time_Scale', 0, 1).listen()
			.onChange((value) =>
			{
				scope.timeScaleTarget = value;
			});
		worldFolder.add(this.params, 'Sun_Elevation', 0, 180).listen()
			.onChange((value) =>
			{
				scope.sky.phi = value;
			});
		worldFolder.add(this.params, 'Sun_Rotation', 0, 360).listen()
			.onChange((value) =>
			{
				scope.sky.theta = value;
			});

		// Input
		let settingsFolder = gui.addFolder('Settings');
		settingsFolder.add(this.params, 'FXAA');
		settingsFolder.add(this.params, 'Shadows')
			.onChange((enabled) =>
			{
				if (enabled)
				{
					this.sky.csm.lights.forEach((light) => {
						light.castShadow = true;
					});
				}
				else
				{
					this.sky.csm.lights.forEach((light) => {
						light.castShadow = false;
					});
				}
			});
		settingsFolder.add(this.params, 'Pointer_Lock')
			.onChange((enabled) =>
			{
				scope.inputManager.setPointerLock(enabled);
			});
		settingsFolder.add(this.params, 'Mouse_Sensitivity', 0, 1)
			.onChange((value) =>
			{
				scope.cameraOperator.setSensitivity(value, value * 0.8);
			});
		settingsFolder.add(this.params, 'Debug_Physics')
			.onChange((enabled) =>
			{
				if (enabled)
				{
					this.cannonDebugRenderer = new CannonDebugRenderer( this.graphicsWorld, this.physicsWorld );
				}
				else
				{
					this.cannonDebugRenderer.clearMeshes();
					this.cannonDebugRenderer = undefined;
				}

				scope.characters.forEach((char) =>
				{
					char.raycastBox.visible = enabled;
				});
			});
		settingsFolder.add(this.params, 'Debug_FPS')
			.onChange((enabled) =>
			{
				UIManager.setFPSVisible(enabled);
			});

		this.scenarioGUIFolder.close();
		worldFolder.close();
		settingsFolder.close();
		gui.open();
	}
}
