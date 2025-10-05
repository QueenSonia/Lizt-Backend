import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from 'src/database.service';
import { DataSource } from 'typeorm';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let dataSource: DataSource;
  let configService: ConfigService;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DataSource,
          useValue: {
            initialize: jest.fn(),
            synchronize: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
    dataSource = module.get<DataSource>(DataSource);
    configService = module.get<ConfigService>(ConfigService);

    // Spy on console and process.exit
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onApplicationBootstrap', () => {
    it('should initialize and synchronize in development mode', async () => {
      // Arrange
      Object.defineProperty(dataSource, 'isInitialized', {
        get: jest.fn(() => false),
      });
      const initializeSpy = jest
        .spyOn(dataSource, 'initialize')
        .mockResolvedValue(dataSource);
      const synchronizeSpy = jest
        .spyOn(dataSource, 'synchronize')
        .mockResolvedValue(undefined);
      const configGetSpy = jest
        .spyOn(configService, 'get')
        .mockReturnValue('development');

      // Act
      await service.onApplicationBootstrap();

      // Assert
      expect(initializeSpy).toHaveBeenCalled();
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Database connection established successfully🗼',
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should initialize but not synchronize in production mode', async () => {
      // Arrange
      Object.defineProperty(dataSource, 'isInitialized', {
        get: jest.fn(() => false),
      });
      const initializeSpy = jest
        .spyOn(dataSource, 'initialize')
        .mockResolvedValue(dataSource);
      const synchronizeSpy = jest
        .spyOn(dataSource, 'synchronize')
        .mockResolvedValue(undefined);
      const configGetSpy = jest
        .spyOn(configService, 'get')
        .mockReturnValue('production');

      // Act
      await service.onApplicationBootstrap();

      // Assert
      expect(initializeSpy).toHaveBeenCalled();
      expect(synchronizeSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Database connection established successfully🗼',
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should not initialize if already initialized', async () => {
      // Arrange
      Object.defineProperty(dataSource, 'isInitialized', {
        get: jest.fn(() => true),
      });
      const initializeSpy = jest
        .spyOn(dataSource, 'initialize')
        .mockResolvedValue(dataSource);
      const synchronizeSpy = jest
        .spyOn(dataSource, 'synchronize')
        .mockResolvedValue(undefined);
      const configGetSpy = jest
        .spyOn(configService, 'get')
        .mockReturnValue('development');

      // Act
      await service.onApplicationBootstrap();

      // Assert
      expect(initializeSpy).not.toHaveBeenCalled();
      expect(synchronizeSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Database connection established successfully🗼',
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      // Arrange
      const error = new Error('Connection failed');
      Object.defineProperty(dataSource, 'isInitialized', {
        get: jest.fn(() => false),
      });
      const initializeSpy = jest
        .spyOn(dataSource, 'initialize')
        .mockRejectedValue(error);
      const configGetSpy = jest
        .spyOn(configService, 'get')
        .mockReturnValue('development');
      const synchronizeSpy = jest
        .spyOn(dataSource, 'synchronize')
        .mockResolvedValue(undefined);

      // Act
      await service.onApplicationBootstrap();

      // Assert
      expect(initializeSpy).toHaveBeenCalled();
      expect(synchronizeSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unable to connect to the database⚠️:',
        error,
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});
