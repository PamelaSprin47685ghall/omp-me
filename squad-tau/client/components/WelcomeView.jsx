import React from 'react';
import { Center, VStack, Heading, Text, Box, Button } from '@chakra-ui/react';
import { Users, Settings } from 'lucide-react';

export default function WelcomeView({ onOpenModelPool }) {
  return (
    <Center h="full" p={8}>
      <VStack spacing={8} maxW="md" textAlign="center">
        <VStack spacing={4}>
          <Box color="blue.500" _dark={{ color: 'blue.300' }}>
            <Users size={48} />
          </Box>
          <Heading size="lg" color="gray.800" _dark={{ color: 'gray.100' }}>
            Welcome to Squad-Tau
          </Heading>
          <Text color="gray.600" _dark={{ color: 'gray.400' }} fontSize="md">
            Type /squad {'<task>'} in your terminal to start a multi-agent orchestrated task.
          </Text>
        </VStack>
        <Button
          colorScheme="blue"
          leftIcon={<Settings size={16} />}
          size="lg"
          onClick={onOpenModelPool}
        >
          Configure Model Pool
        </Button>
      </VStack>
    </Center>
  );
}
